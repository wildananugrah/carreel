```sh
# Create a driver
  bun run scripts/create-user.ts --role DRIVER --email driver@example.com --name "John Doe" --password secret123 
  bun run scripts/create-user.ts --role DRIVER --email driver1@olxautos.com --name "Driver 1" --password secret123
  bun run scripts/create-user.ts --role DRIVER --email driver2@olxautos.com --name "Driver 2" --password secret123 
  bun run scripts/create-user.ts --role DRIVER --email driver3@olxautos.com --name "Driver 3" --password secret123 
  bun run scripts/create-user.ts --role DRIVER --email driver4@olxautos.com --name "Driver 4" --password secret123 
  bun run scripts/create-user.ts --role DRIVER --email driver5@olxautos.com --name "Driver 5" --password secret123            
                                                                                                                            
  # Create a planner                                                                                                        
  bun run scripts/create-user.ts --role PLANNER --email planner@example.com --name "Jane Doe" --password secret123

  bun run scripts/create-user.ts --role PLANNER --email planner1@olxautos.com --name "Planner 1" --password secret123
  bun run scripts/create-user.ts --role PLANNER --email planner2@olxautos.com --name "Planner 2" --password secret123
  bun run scripts/create-user.ts --role PLANNER --email planner3@olxautos.com --name "Planner 3" --password secret123
  bun run scripts/create-user.ts --role PLANNER --email planner4@olxautos.com --name "Planner 4" --password secret123
  bun run scripts/create-user.ts --role PLANNER --email planner5@olxautos.com --name "Planner 5" --password secret123        
                                                                                                                            
  # Create an admin
  bun run scripts/create-user.ts --role ADMIN --email admin@example.com --name "Admin User" --password secret123
```

## Driver
email: driver1@olxautos.com password: secret123
email: driver2@olxautos.com password: secret123
email: driver3@olxautos.com password: secret123
email: driver4@olxautos.com password: secret123
email: driver5@olxautos.com password: secret123

## Planner
email: planner1@olxautos.com password: secret123
email: planner2@olxautos.com password: secret123
email: planner3@olxautos.com password: secret123
email: planner4@olxautos.com password: secret123
email: planner5@olxautos.com password: secret123

```result
User created successfully!
  ID:    6b2f68e9-8f00-46f5-bcbb-f43f953f723b
  Email: driver1@olxautos.com
  Name:  Driver 1
  Role:  DRIVER
User created successfully!
  ID:    39a72139-7ee9-4bbe-9bdf-2de07ba07481
  Email: driver2@olxautos.com
  Name:  Driver 2
  Role:  DRIVER
User created successfully!
  ID:    94ae9b52-98c8-4dc3-b399-945ab19738da
  Email: driver3@olxautos.com
  Name:  Driver 3
  Role:  DRIVER
User created successfully!
  ID:    d8341f17-7fa1-46f3-aaaf-c669178b5952
  Email: driver4@olxautos.com
  Name:  Driver 4
  Role:  DRIVER
User created successfully!
  ID:    31384451-6a3a-4bbc-813b-8574eda2bac8
  Email: driver5@olxautos.com
  Name:  Driver 5
  Role:  DRIVER

User created successfully!
  ID:    90940be5-ca2e-4136-b710-aef49ca451ac
  Email: planner1@olxautos.com
  Name:  Planner 1
  Role:  PLANNER
User created successfully!
  ID:    7967387e-d294-4cee-8231-beac24547cc2
  Email: planner2@olxautos.com
  Name:  Planner 2
  Role:  PLANNER
User created successfully!
  ID:    3fa4e83a-a9bf-4ee3-991a-1f4d6bc7113f
  Email: planner3@olxautos.com
  Name:  Planner 3
  Role:  PLANNER
User created successfully!
  ID:    a7ababbf-2c5f-415b-88b8-e79cf62f815f
  Email: planner4@olxautos.com
  Name:  Planner 4
  Role:  PLANNER
User created successfully!
  ID:    76bdc7cd-e5bf-4a41-ba29-bb832f00b998
  Email: planner5@olxautos.com
  Name:  Planner 5
  Role:  PLANNER
```

update users set email='planner1@olxautos.com' where id='90940be5-ca2e-4136-b710-aef49ca451ac';
update users set email='planner2@olxautos.com' where id='7967387e-d294-4cee-8231-beac24547cc2';
update users set email='planner3@olxautos.com' where id='3fa4e83a-a9bf-4ee3-991a-1f4d6bc7113f';
update users set email='planner4@olxautos.com' where id='a7ababbf-2c5f-415b-88b8-e79cf62f815f';
update users set email='planner5@olxautos.com' where id='76bdc7cd-e5bf-4a41-ba29-bb832f00b998';