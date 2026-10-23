
```bash
hyperframes cloudrun deploy --project <gcp-project> --region us-central1
hyperframes cloudrun sites create ./project
hyperframes cloudrun render ./project --width 1920 --height 1080 --wait
hyperframes cloudrun progress <execution-name>
hyperframes cloudrun destroy --project <gcp-project>
```
