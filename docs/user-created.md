```bash
bun run scripts/create-user.ts --role DRIVER --email driver1@autolux.co.id --name "Driver 1" --password secret123
bun run scripts/create-user.ts --role DRIVER --email driver2@autolux.co.id --name "Driver 1" --password secret123

bun run scripts/create-user.ts --role PLANNER --email planner1@autolux.co.id --name "Planner 1" --password secret123
```
**Driver:**
URL: https://driver.carreel.id
Users:
1. e: driver1@autolux.co.id p: secret123
2. e: driver2@autolux.co.id p: secret123

**Planner:**
URL: https://planner.carreel.id
1. e: planner1@autolux.co.id p: secret123