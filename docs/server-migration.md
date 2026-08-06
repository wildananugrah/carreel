# Server Migration Runbook

Step-by-step guide for moving the whole Carreel production stack (app, database, object storage, CI/CD) from one server to another with minimal downtime.

Placeholders used throughout — substitute your own values:
- `OLD_HOST` — old server IP, `OLD_USER` — SSH user, `OLD_KEY` — SSH private key path
- `NEW_HOST` — new server IP, `NEW_USER` — SSH user, `NEW_KEY` — SSH private key path

## What actually needs migrating

Everything else (app code, PM2 config, Nginx config) is redeployed fresh from git on the new server — nothing to move. Only **stateful data** needs an explicit migration step:

1. **PostgreSQL** (`carreel-driver-db` container, `carreel_driver` database) — inspections, users, workspaces, everything.
2. **MinIO** (`carreel-minio` container, `minio-data` volume) — the actual uploaded photos/videos.
3. **`.env` files** — secrets (API keys, DB credentials) aren't in git.

## Phase 1 — Prep the new server (no downtime)

Do this whenever, ahead of the actual cutover. The new server should end up fully running with an *empty* database/MinIO, reachable only by IP — don't flip DNS or issue SSL certs yet.

1. **SSH key**: generate a keypair on the new server and add the public key at [github.com/settings/keys](https://github.com/settings/keys) so `git pull`/`git clone` over SSH works.
   ```bash
   ssh-keygen -t ed25519 -C "carreel-<new-server-name>"
   cat ~/.ssh/id_ed25519.pub   # paste into GitHub → New SSH key
   ssh -T git@github.com       # verify: "Hi <you>! You've successfully authenticated..."
   ```

2. **Base tooling**:
   ```bash
   curl -fsSL https://bun.sh/install | bash
   npm i -g pm2
   # + Docker, Docker Compose, Nginx, Certbot via your distro's package manager
   ```

3. **Clone the repo** at the exact path `deploy-all.sh` and `.github/workflows/deploy.yml` expect:
   ```bash
   mkdir -p /root/repo && cd /root/repo
   git clone git@github.com:wildananugrah/carreel.git
   ```

4. **Start infra**:
   ```bash
   cd driver-app/database && docker compose up -d
   cd ../../minio && docker compose up -d
   cd ../monitoring && docker compose up -d
   ```

5. **Self-hosted GitHub Actions runner** — `deploy.yml` uses `runs-on: self-hosted` with no label, so it runs on *whichever* registered runner is idle. Register one on the new server via repo **Settings → Actions → Runners → New self-hosted runner**, then install it as a service so it survives reboots/disconnects:
   ```bash
   ./config.sh --url https://github.com/wildananugrah/carreel --token <TOKEN>
   sudo ./svc.sh install
   sudo ./svc.sh start
   ```
   Leave the old server's runner running for now — don't remove it until Phase 6.

6. **PM2 boot persistence**:
   ```bash
   pm2 startup   # run the command it prints
   pm2 save
   ```

## Phase 2 — Copy `.env` secrets

Not in git — copy directly, server to server via your local machine:

```bash
for app in driver-app/backend planner-app/backend driver-app/frontend planner-app/frontend; do
  scp -i $OLD_KEY $OLD_USER@$OLD_HOST:/root/repo/carreel/$app/.env ./tmp.env
  scp -i $NEW_KEY ./tmp.env $NEW_USER@$NEW_HOST:/root/repo/carreel/$app/.env
  rm ./tmp.env
done
```

## Phase 3 — First-pass bulk sync (old server still fully live, no downtime)

### PostgreSQL

Pipe `pg_dump`'s stdout straight through SSH to a local file, then pipe that file straight through SSH into `pg_restore`'s stdin on the new server — no dump file left inside either container or host, and no container-vs-host path mix-ups. `--clean --if-exists` makes the restore safe to re-run (needed for Phase 4's final sync).

If your SSH user isn't in the `docker` group, prefix the `docker exec` calls with `sudo` (or run `sudo usermod -aG docker $OLD_USER` / `$NEW_USER` once and reconnect, so you don't need `sudo` on every command):

```bash
ssh -i $OLD_KEY $OLD_USER@$OLD_HOST \
  "sudo docker exec carreel-driver-db pg_dump -U carreel -Fc carreel_driver" > carreel_driver.dump

ssh -i $NEW_KEY $NEW_USER@$NEW_HOST \
  "sudo docker exec -i carreel-driver-db pg_restore -U carreel -d carreel_driver --clean --if-exists" < carreel_driver.dump
```

**Verify the restore** — compare exact row counts for every table, old vs new. This query needs no table list maintained by hand; it counts every table in the `public` schema:

```bash
COUNT_QUERY="SELECT table_name, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I', table_name), false, true, '')))[1]::text::int AS row_count FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;"

ssh -i $OLD_KEY $OLD_USER@$OLD_HOST "sudo docker exec carreel-driver-db psql -U carreel -d carreel_driver -c \"$COUNT_QUERY\"" > old-counts.txt
ssh -i $NEW_KEY $NEW_USER@$NEW_HOST "sudo docker exec carreel-driver-db psql -U carreel -d carreel_driver -c \"$COUNT_QUERY\"" > new-counts.txt

diff old-counts.txt new-counts.txt && echo "MATCH" || echo "MISMATCH — see diff above"
```

A mismatch right after Phase 3's bulk sync is expected if the old server took writes between the dump and now — that's exactly what Phase 4's final incremental sync catches. A mismatch *after* Phase 4 (with writes stopped) means something is actually wrong and needs investigating before cutover.

For a quicker manual spot-check, pull the single most recent row from a high-traffic table and eyeball it:
```bash
ssh -i $NEW_KEY $NEW_USER@$NEW_HOST \
  "sudo docker exec carreel-driver-db psql -U carreel -d carreel_driver -c 'SELECT id, \"createdAt\" FROM inspections ORDER BY \"createdAt\" DESC LIMIT 1;'"
```

### MinIO

`pg_dump`-style file export doesn't apply to object storage — use `mc mirror` over SSH tunnels instead, so the raw MinIO ports never touch the public internet. Open two tunnels in separate terminals (keep them running):

```bash
# Terminal 1
ssh -i $OLD_KEY -L 19000:localhost:9000 $OLD_USER@$OLD_HOST
ssh -i mhamzah.pem -L 19000:localhost:9000 ubuntu@$OLD_HOST
# Terminal 2
ssh -i $NEW_KEY -L 19001:localhost:9000 $NEW_USER@$NEW_HOST
```

Then, on your local machine (`brew install minio-mc` if needed):

```bash
mc alias set old-minio http://localhost:19000 carreel carreel_secret
mc alias set new-minio http://localhost:19001 carreel carreel_secret
mc mirror old-minio/ new-minio/ --overwrite
```

Safe to re-run — a second pass only transfers what changed, which is exactly what Phase 4 needs.

## Phase 4 — Cutover (brief write-freeze)

The one genuinely risky, hard-to-reverse part — confirm before running.

```bash
# 1. Stop writes on the OLD server
ssh -i $OLD_KEY $OLD_USER@$OLD_HOST "pm2 stop all"

# 2. Final incremental sync — re-run the exact pg_dump/pg_restore pipe commands from Phase 3
#    (fast: unchanged rows dump/restore quickly)

# 3. Final incremental MinIO sync — tunnels from Phase 3 still open
mc mirror old-minio/ new-minio/ --overwrite

# 4. Start the app on the NEW server
ssh -i $NEW_KEY $NEW_USER@$NEW_HOST \
  "cd driver-app/backend && pm2 start pm2.config.cjs && cd ../../planner-app/backend && pm2 start pm2.config.cjs"
```

## Phase 5 — DNS + SSL, then verify

- Update DNS A records (Cloudflare) for all 7 subdomains — `driver`, `driver-api`, `planner`, `planner-api`, `ws`, `minio`, `monit` — from the old IP to the new IP.
- Once DNS propagates, run the certbot + Nginx steps from [`deploy/notes.md`](../deploy/notes.md) **on the new server**. SSL certs aren't copied over — HTTP-01 validation needs DNS pointed at the server being issued to, so it's cleaner to just issue fresh.
- Verify: log into the driver app, confirm existing historical inspections show up, and that an existing photo/video still loads (proves both DB and MinIO migrated correctly).

## Phase 6 — Decommission the old server

Don't delete anything yet — leave the old server powered off (not destroyed) for a few days as a rollback safety net. Once confident:

- Remove its GitHub Actions runner: **Settings → Actions → Runners** → remove, or on the old server:
  ```bash
  cd actions-runner
  sudo ./svc.sh stop
  sudo ./svc.sh uninstall
  ./config.sh remove --token <removal token from the same Settings→Runners page>
  ```
- Terminate the old server.

## Why not just copy the raw Docker volumes?

`pg_dump`/`pg_restore` and `mc mirror` are used instead of tarring up `driver-db-data`/`minio-data` directly because:
- They work while the source is still live and serving traffic — no downtime needed for the bulk transfer.
- `pg_dump` takes a transactionally consistent snapshot automatically; a raw file copy of a live Postgres data directory can be corrupted mid-write.
- Both are safely re-runnable, which is what makes the two-pass (bulk, then final incremental) cutover strategy possible.
