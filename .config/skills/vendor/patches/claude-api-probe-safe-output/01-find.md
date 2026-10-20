    def flush():
        if args.json:
            with open(args.json, "w") as f:
                json.dump({"mode": args.mode, "betas": betas, "results": all_results,
                           "summaries": [{k: v for k, v in s.items() if k != "_results"} for s in summaries]}, f, indent=2)

