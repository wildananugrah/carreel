### how to deploy

1. setup DNS record in cloudflare

2. create certification using 

```bash
certbot certonly --nginx -d driver.carreel.id
certbot certonly --nginx -d driver-api.carreel.id
certbot certonly --nginx -d planner.carreel.id
certbot certonly --nginx -d planner-api.carreel.id
certbot certonly --nginx -d ws.carreel.id
certbot certonly --nginx -d minio.carreel.id
certbot certonly --nginx -d monit.carreel.id
```

3. copy nginx config

```bash
cp nginx/driver.carreel.id /etc/nginx/sites-available/driver.carreel.id
cp nginx/driver-api.carreel.id /etc/nginx/sites-available/driver-api.carreel.id
cp nginx/planner.carreel.id /etc/nginx/sites-available/planner.carreel.id
cp nginx/planner-api.carreel.id /etc/nginx/sites-available/planner-api.carreel.id
cp nginx/ws.carreel.id /etc/nginx/sites-available/ws.carreel.id
cp nginx/minio.carreel.id /etc/nginx/sites-available/minio.carreel.id
cp nginx/monit.carreel.id /etc/nginx/sites-available/monit.carreel.id
```

4. link it

```bash
ln -s /etc/nginx/sites-available/driver.carreel.id /etc/nginx/sites-enabled/driver.carreel.id
ln -s /etc/nginx/sites-available/planner.carreel.id /etc/nginx/sites-enabled/planner.carreel.id
ln -s /etc/nginx/sites-available/driver-api.carreel.id /etc/nginx/sites-enabled/driver-api.carreel.id
ln -s /etc/nginx/sites-available/planner-api.carreel.id /etc/nginx/sites-enabled/planner-api.carreel.id
ln -s /etc/nginx/sites-available/ws.carreel.id /etc/nginx/sites-enabled/ws.carreel.id
ln -s /etc/nginx/sites-available/minio.carreel.id /etc/nginx/sites-enabled/minio.carreel.id
ln -s /etc/nginx/sites-available/monit.carreel.id /etc/nginx/sites-enabled/monit.carreel.id
```

5. check the nginx config

```bash
nginx -t
```

6. restart nginx

```bash
systemctl reload nginx; systemctl restart nginx; systemctl status nginx
```

ssl_certificate /etc/letsencrypt/live/oc.carreel.id/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/oc.carreel.id/privkey.pem;