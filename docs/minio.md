```sh
docker system df -v | grep minio
# or check the volume directly
du -sh $(docker inspect carreel-minio --format '{{range .Mounts}}{{.Source}}{{end}}' 2>/dev/null) 2>/dev/null
```

```sh
docker system df -v | grep minio
# or check the volume directly
du -sh $(docker inspect carreel-minio --format '{{range .Mounts}}{{.Source}}{{end}}' 2>/dev/null) 2>/dev/null
```

```sh
# Find the MinIO data directory from docker-compose
cat /Users/bellinnn/Documents/projects/carreel/minio/docker-compose.yml
# Then:
du -sh <data-directory>
```

```sh
# Check volume size
docker system df -v | grep minio

# Or more precisely:
docker run --rm -v carreel_minio-data:/data alpine du -sh /data
```