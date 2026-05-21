                                                                                                      
  Important — save these credentials:                                                                   
  - Admin user: admin                                                                                   
  - Password: dwB6TRrMbh         

cd ~/actions-runner
rm -rf *

curl -o actions-runner-linux-x64-2.334.0.tar.gz -L \
  https://github.com/actions/runner/releases/download/v2.334.0/actions-runner-linux-x64-2.334.0.tar.gz

tar xzf ./actions-runner-linux-x64-2.334.0.tar.gz

RUNNER_ALLOW_RUNASROOT=1 ./config.sh \
  --url https://github.com/wildananugrah/carreel \
  --token ADSDIV5ZOF6PEY2MQAACOJDKBNEIG                                
                               
RUNNER_ALLOW_RUNASROOT=1 ./run.sh

RUNNER_ALLOW_RUNASROOT=1 ./svc.sh install
RUNNER_ALLOW_RUNASROOT=1 ./svc.sh start

# Check service status
RUNNER_ALLOW_RUNASROOT=1 ./svc.sh status