            path = os.path.join(dirpath, fn)
            if os.path.islink(path):
                continue
            try:
                with open(path, "r", encoding="utf-8", errors="replace") as f:
