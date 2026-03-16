### how to deploy

1. setup DNS record in cloudflare

2. create certification using 

```bash
certbot certonly --nginx -d driver.mhamzah.id
certbot certonly --nginx -d driver-api.mhamzah.id
certbot certonly --nginx -d planner.mhamzah.id
certbot certonly --nginx -d planner-api.mhamzah.id
certbot certonly --nginx -d ws.mhamzah.id
certbot certonly --nginx -d minio.mhamzah.id
```

3. copy nginx config

```bash
cp nginx/driver.mhamzah.id /etc/nginx/sites-available/driver.mhamzah.id
cp nginx/driver-api.mhamzah.id /etc/nginx/sites-available/driver-api.mhamzah.id
cp nginx/planner.mhamzah.id /etc/nginx/sites-available/planner.mhamzah.id
cp nginx/planner-api.mhamzah.id /etc/nginx/sites-available/planner-api.mhamzah.id
cp nginx/ws.mhamzah.id /etc/nginx/sites-available/ws.mhamzah.id
cp nginx/minio.mhamzah.id /etc/nginx/sites-available/minio.mhamzah.id
```

4. link it

```bash
ln -s /etc/nginx/sites-available/driver.mhamzah.id /etc/nginx/sites-enabled/driver.mhamzah.id
ln -s /etc/nginx/sites-available/driver.mhamzah.id /etc/nginx/sites-enabled/driver.mhamzah.id
ln -s /etc/nginx/sites-available/planner-api.mhamzah.id /etc/nginx/sites-enabled/planner-api.mhamzah.id
ln -s /etc/nginx/sites-available/planner-api.mhamzah.id /etc/nginx/sites-enabled/planner-api.mhamzah.id
ln -s /etc/nginx/sites-available/ws.mhamzah.id /etc/nginx/sites-enabled/ws.mhamzah.id
ln -s /etc/nginx/sites-available/minio.mhamzah.id /etc/nginx/sites-enabled/minio.mhamzah.id
```

5. check the nginx config

```bash
nginx -t
```

6. restart nginx

```bash
systemctl reload nginx; systemctl restart nginx; systemctl status nginx
```

ssl_certificate /etc/letsencrypt/live/oc.mhamzah.id/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/oc.mhamzah.id/privkey.pem;