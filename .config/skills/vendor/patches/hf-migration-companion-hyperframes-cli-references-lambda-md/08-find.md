
```bash
npx hyperframes lambda policies user                                  # inline policy for an IAM user
npx hyperframes lambda policies role                                  # { TrustRelationship, InlinePolicy }
npx hyperframes lambda policies validate ./infra/iam/hf-deploy.json   # CI gate
```
