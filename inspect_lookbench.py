from datasets import load_dataset

configs = ["aigen_streetlook", "aigen_studio", "noise"]

for cfg in configs:
    print("\n=== Config:", cfg)
    try:
        ds = load_dataset("srpone/look-bench", cfg)
    except Exception as e:
        print("Failed to load config:", e)
        continue

    for split_name, split in ds.items():
        print(f"Split: {split_name}  |  #examples: {len(split)}")
        print("Features:", split.features)
        sample = split[0]
        
        print("Sample keys:", list(sample.keys()))
        # Print first few fields and types
        for k, v in sample.items():
            t = type(v)
            # don't print huge blobs
            try:
                preview = v if (isinstance(v, (str, int, float)) and len(str(v)) < 300) else str(t)
            except Exception:
                preview = str(t)
            print(f" - {k}: {t} -> {preview}")
        # Try to display common text fields
        for txt_key in ("caption", "text", "prompt", "label", "description"):
            if txt_key in sample:
                print(f"{txt_key} sample:", sample[txt_key])
        break
