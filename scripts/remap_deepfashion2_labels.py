"""
Remap DeepFashion2 class indices to sequential 0-7 for YOLOv8 training.
"""
import os
from pathlib import Path

# Comprehensive mapping: handles both DeepFashion2 IDs (1-13) and intermediate IDs
OLD_TO_NEW = {
    # DeepFashion2 original IDs (1-13)
    1: 1,   # short_sleeve_top -> tshirt
    2: 0,   # long_sleeve_top -> shirt
    3: 2,   # short_sleeve_outwear -> jacket
    4: 2,   # long_sleeve_outwear -> jacket
    5: 3,   # vest -> tank_top
    6: 3,   # sling -> tank_top
    7: 5,   # shorts -> shorts
    8: 4,   # trousers -> pants
    9: 6,   # skirt -> skirt
    10: 7,  # short_sleeve_dress -> dress
    11: 7,  # long_sleeve_dress -> dress
    12: 7,  # vest_dress -> dress
    13: 7,  # sling_dress -> dress
    
    # Intermediate IDs (already partially converted)
    0: 0,   # shirt -> shirt
    16: 4,  # pants -> pants
    17: 5,  # shorts -> shorts
    18: 6,  # skirt -> skirt
    20: 2,  # jacket -> jacket
}

def remap_labels(base_path: str):
    """Remap class indices in all label files."""
    base_path = Path(base_path)
    
    for split in ['train', 'val']:
        label_dir = base_path / 'labels' / split
        if not label_dir.exists():
            print(f"[ERROR] Directory not found: {label_dir}")
            continue
        
        label_files = list(label_dir.glob('*.txt'))
        print(f"\nProcessing {len(label_files)} files in {split}/")
        
        remapped_count = 0
        for label_file in label_files:
            with open(label_file, 'r') as f:
                lines = f.readlines()
            
            new_lines = []
            file_changed = False
            for line in lines:
                parts = line.strip().split()
                if len(parts) >= 5:  # class_id x y w h
                    old_class = int(parts[0])
                    if old_class in OLD_TO_NEW:
                        new_class = OLD_TO_NEW[old_class]
                        if new_class != old_class:
                            file_changed = True
                        new_lines.append(f"{new_class} {' '.join(parts[1:])}\n")
                    else:
                        print(f"[WARNING] Unknown class {old_class} in {label_file.name}")
                        new_lines.append(line)
                else:
                    new_lines.append(line)
            
            if file_changed:
                with open(label_file, 'w') as f:
                    f.writelines(new_lines)
                remapped_count += 1
        
        print(f"[OK] Remapped {remapped_count}/{len(label_files)} files")

def update_yaml():
    """Update the YAML file with sequential class indices."""
    yaml_path = Path('data/deepfashion2_yolo.yaml')
    
    new_yaml = f"""path: D:\\marketplace\\data\\fashion_train
train: images/train
val: images/val
nc: 8
names:
  0: shirt
  1: tshirt
  2: jacket
  3: tank_top
  4: pants
  5: shorts
  6: skirt
  7: dress
"""
    
    with open(yaml_path, 'w') as f:
        f.write(new_yaml)
    
    print(f"\n[OK] Updated {yaml_path} with sequential class indices 0-7")

if __name__ == '__main__':
    print("Remapping DeepFashion2 class indices to sequential 0-7...\n")
    
    # Remap label files
    remap_labels('data/fashion_train')
    
    # Update YAML
    update_yaml()
    
    print("\nDone! You can now train with the remapped dataset.")
