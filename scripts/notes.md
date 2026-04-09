```sh
# Create a driver
  bun run scripts/create-user.ts --role DRIVER --email driver@example.com --name "John Doe" --password secret123            
                                                                                                                            
  # Create a planner                                                                                                        
  bun run scripts/create-user.ts --role PLANNER --email planner@example.com --name "Jane Doe" --password secret123          
                                                                                                                            
  # Create an admin
  bun run scripts/create-user.ts --role ADMIN --email admin@example.com --name "Admin User" --password secret123
```