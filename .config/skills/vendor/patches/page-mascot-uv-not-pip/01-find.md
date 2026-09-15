Either way, the build needs Python 3:

```bash
python3 -c "import PIL, numpy, scipy" 2>&1
```

If that fails: `pip install -r <skill-dir>/scripts/requirements.txt`. Stop and say so
rather than working around it.
