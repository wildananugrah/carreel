### how to deploy

1. setup DNS record in cloudflare

2. create certification using 

```bash
certbot certonly --nginx -d market.mhamzah.id
certbot certonly --nginx -d market-api.mhamzah.id
certbot certonly --nginx -d market-ws.mhamzah.id

certbot certonly --nginx -d carreel.id
certbot certonly --nginx -d api.carreel.id
certbot certonly --nginx -d ws.carreel.id
```

3. copy nginx config

```bash
cp nginx/market.mhamzah.id /etc/nginx/sites-available/market.mhamzah.id
cp nginx/market-api.mhamzah.id /etc/nginx/sites-available/market-api.mhamzah.id
cp nginx/market-ws.mhamzah.id /etc/nginx/sites-available/market-ws.mhamzah.id

cp nginx/carreel.id /etc/nginx/sites-available/carreel.id
cp nginx/api.carreel.id /etc/nginx/sites-available/api.carreel.id
cp nginx/ws.carreel.id /etc/nginx/sites-available/ws.carreel.id
```

4. link it

```bash
ln -s /etc/nginx/sites-available/market.mhamzah.id /etc/nginx/sites-enabled/market.mhamzah.id
ln -s /etc/nginx/sites-available/market-api.mhamzah.id /etc/nginx/sites-enabled/market-api.mhamzah.id
ln -s /etc/nginx/sites-available/market-ws.mhamzah.id /etc/nginx/sites-enabled/market-ws.mhamzah.id

ln -s /etc/nginx/sites-available/carreel.id /etc/nginx/sites-enabled/carreel.id
ln -s /etc/nginx/sites-available/api.carreel.id /etc/nginx/sites-enabled/api.carreel.id
ln -s /etc/nginx/sites-available/ws.carreel.id /etc/nginx/sites-enabled/ws.carreel.id
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