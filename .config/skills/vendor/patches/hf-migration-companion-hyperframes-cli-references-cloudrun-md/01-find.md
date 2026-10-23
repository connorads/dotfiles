
```bash
npx hyperframes cloudrun deploy --project <gcp-project> --region us-central1
npx hyperframes cloudrun sites create ./project
npx hyperframes cloudrun render ./project --width 1920 --height 1080 --wait
npx hyperframes cloudrun progress <execution-name>
npx hyperframes cloudrun destroy --project <gcp-project>
```
