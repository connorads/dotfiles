    def flush():
        if args.json:
            # Check the opened file before truncating: captures and report paths can be untrusted.
            import stat
            if os.path.islink(args.json):
                raise OSError("refusing symlinked report output")
            fd = os.open(args.json, os.O_WRONLY | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0), 0o600)
            try:
                info = os.fstat(fd)
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                    raise OSError("refusing non-regular or hard-linked report output")
                os.ftruncate(fd, 0)
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    fd = None
                    json.dump({"mode": args.mode, "betas": betas, "results": all_results,
                               "summaries": [{k: v for k, v in s.items() if k != "_results"} for s in summaries]}, f, indent=2)
            finally:
                if fd is not None:
                    os.close(fd)

