"""
Multi-label fashion attribute extraction model training script
Supports: category, color, pattern, material, season, occasion extraction
"""
import csv
import json
import os
from pathlib import Path
from typing import Dict, Tuple, List
import numpy as np

import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms
from torch.cuda.amp import autocast, GradScaler
import timm
from tqdm import tqdm
from PIL import Image

from config import TrainingConfig, CATEGORY_NAMES


class MultiLabelFashionDataset(Dataset):
    """Dataset for multi-label attribute extraction"""
    
    def __init__(self, csv_path: str, config: TrainingConfig, is_train: bool = True):
        self.config = config
        self.is_train = is_train
        self.rows = []
        
        # Read CSV with multi-label annotations
        with open(csv_path, 'r') as f:
            reader = csv.DictReader(f)
            for row in reader:
                # Expected CSV format:
                # path, category_id, color_ids, pattern_id, material_id, season_ids, occasion_ids
                self.rows.append({
                    'path': row['path'],
                    'category_id': int(row['category_id']) - 1,  # 1-indexed to 0-indexed
                    'color_ids': [int(x) for x in row.get('color_ids', '0').split(',') if x],
                    'pattern_id': int(row.get('pattern_id', 0)),
                    'material_id': int(row.get('material_id', 0)),
                    'season_ids': [int(x) for x in row.get('season_ids', '4').split(',') if x],  # default all-season
                    'occasion_ids': [int(x) for x in row.get('occasion_ids', '0').split(',') if x]
                })
        
        # Build transforms
        if is_train:
            self.transform = transforms.Compose([
                transforms.RandomResizedCrop(
                    config.img_size, 
                    scale=(config.crop_scale_min, config.crop_scale_max)
                ),
                transforms.RandomHorizontalFlip(p=0.5),
                transforms.ColorJitter(
                    brightness=config.color_jitter,
                    contrast=config.color_jitter,
                    saturation=config.color_jitter,
                    hue=config.color_jitter * 0.25
                ),
                transforms.RandomRotation(15),
                transforms.ToTensor(),
                transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
            ])
        else:
            self.transform = transforms.Compose([
                transforms.Resize((config.img_size, config.img_size)),
                transforms.ToTensor(),
                transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
            ])
    
    def __len__(self) -> int:
        return len(self.rows)
    
    def __getitem__(self, idx: int) -> Tuple[torch.Tensor, Dict[str, torch.Tensor]]:
        row = self.rows[idx]
        
        # Load and transform image
        try:
            img = Image.open(row['path']).convert('RGB')
            img_tensor = self.transform(img)
        except Exception as e:
            print(f"Error loading {row['path']}: {e}")
            # Return black image on error
            img_tensor = torch.zeros(3, self.config.img_size, self.config.img_size)
        
        # Build multi-label targets
        labels = {
            'category': torch.tensor(row['category_id'], dtype=torch.long),
            'colors': self._make_multilabel(row['color_ids'], self.config.num_colors),
            'pattern': torch.tensor(row['pattern_id'], dtype=torch.long),
            'material': torch.tensor(row['material_id'], dtype=torch.long),
            'seasons': self._make_multilabel(row['season_ids'], self.config.num_seasons),
            'occasions': self._make_multilabel(row['occasion_ids'], self.config.num_occasions)
        }
        
        return img_tensor, labels
    
    @staticmethod
    def _make_multilabel(ids: List[int], num_classes: int) -> torch.Tensor:
        """Convert list of class IDs to multi-hot vector"""
        target = torch.zeros(num_classes, dtype=torch.float32)
        for cid in ids:
            if 0 <= cid < num_classes:
                target[cid] = 1.0
        return target


class MultiHeadAttributeModel(nn.Module):
    """Multi-head model for attribute extraction"""
    
    def __init__(self, config: TrainingConfig):
        super().__init__()
        self.config = config
        
        # Backbone
        self.backbone = timm.create_model(
            config.model_name,
            pretrained=config.pretrained,
            num_classes=0,  # Remove classification head
            global_pool='avg'
        )
        
        # Get feature dimension
        with torch.no_grad():
            dummy = torch.randn(1, 3, config.img_size, config.img_size)
            features = self.backbone(dummy)
            feature_dim = features.shape[1]
        
        # Dropout for regularization
        self.dropout = nn.Dropout(config.dropout)
        
        # Multi-head classifiers
        self.category_head = nn.Linear(feature_dim, config.num_categories)
        self.color_head = nn.Linear(feature_dim, config.num_colors)
        self.pattern_head = nn.Linear(feature_dim, config.num_patterns)
        self.material_head = nn.Linear(feature_dim, config.num_materials)
        self.season_head = nn.Linear(feature_dim, config.num_seasons)
        self.occasion_head = nn.Linear(feature_dim, config.num_occasions)
    
    def forward(self, x: torch.Tensor) -> Dict[str, torch.Tensor]:
        features = self.backbone(x)
        features = self.dropout(features)
        
        return {
            'category': self.category_head(features),
            'colors': self.color_head(features),
            'pattern': self.pattern_head(features),
            'material': self.material_head(features),
            'seasons': self.season_head(features),
            'occasions': self.occasion_head(features)
        }


class MultiTaskLoss(nn.Module):
    """Combined loss for multi-task learning with learnable weights"""
    
    def __init__(self, config: TrainingConfig):
        super().__init__()
        # Single-label tasks
        self.ce_loss = nn.CrossEntropyLoss(label_smoothing=config.label_smoothing)
        # Multi-label tasks
        self.bce_loss = nn.BCEWithLogitsLoss()
        
        # Learnable task weights (homoscedastic uncertainty)
        self.log_vars = nn.Parameter(torch.zeros(6))
    
    def forward(
        self, 
        predictions: Dict[str, torch.Tensor], 
        targets: Dict[str, torch.Tensor]
    ) -> Tuple[torch.Tensor, Dict[str, float]]:
        
        # Single-label losses
        loss_category = self.ce_loss(predictions['category'], targets['category'])
        loss_pattern = self.ce_loss(predictions['pattern'], targets['pattern'])
        loss_material = self.ce_loss(predictions['material'], targets['material'])
        
        # Multi-label losses
        loss_colors = self.bce_loss(predictions['colors'], targets['colors'])
        loss_seasons = self.bce_loss(predictions['seasons'], targets['seasons'])
        loss_occasions = self.bce_loss(predictions['occasions'], targets['occasions'])
        
        # Weighted combination with uncertainty weighting
        losses = torch.stack([
            loss_category, loss_colors, loss_pattern,
            loss_material, loss_seasons, loss_occasions
        ])
        
        # Multi-task uncertainty weighting: L_total = sum(exp(-log_var) * loss + log_var)
        weighted_losses = torch.exp(-self.log_vars) * losses + self.log_vars
        total_loss = weighted_losses.sum()
        
        loss_dict = {
            'total': total_loss.item(),
            'category': loss_category.item(),
            'colors': loss_colors.item(),
            'pattern': loss_pattern.item(),
            'material': loss_material.item(),
            'seasons': loss_seasons.item(),
            'occasions': loss_occasions.item()
        }
        
        return total_loss, loss_dict


def compute_metrics(
    predictions: Dict[str, torch.Tensor],
    targets: Dict[str, torch.Tensor]
) -> Dict[str, float]:
    """Compute accuracy metrics"""
    metrics = {}
    
    # Single-label accuracy
    for key in ['category', 'pattern', 'material']:
        preds = predictions[key].argmax(dim=1)
        acc = (preds == targets[key]).float().mean().item()
        metrics[f'{key}_acc'] = acc
    
    # Multi-label accuracy (exact match)
    for key in ['colors', 'seasons', 'occasions']:
        preds = (predictions[key].sigmoid() > 0.5).float()
        exact_match = (preds == targets[key]).all(dim=1).float().mean().item()
        metrics[f'{key}_exact'] = exact_match
    
    return metrics


def train_epoch(
    model: nn.Module,
    dataloader: DataLoader,
    criterion: MultiTaskLoss,
    optimizer: torch.optim.Optimizer,
    scaler: GradScaler,
    device: str,
    config: TrainingConfig,
    epoch: int
) -> Dict[str, float]:
    """Train for one epoch"""
    model.train()
    total_losses = {k: 0.0 for k in ['total', 'category', 'colors', 'pattern', 'material', 'seasons', 'occasions']}
    total_metrics = {}
    
    pbar = tqdm(dataloader, desc=f"Epoch {epoch+1} [Train]")
    for batch_idx, (images, targets) in enumerate(pbar):
        images = images.to(device)
        targets = {k: v.to(device) for k, v in targets.items()}
        
        optimizer.zero_grad()
        
        # Mixed precision forward pass
        with autocast(enabled=config.mixed_precision):
            predictions = model(images)
            loss, loss_dict = criterion(predictions, targets)
        
        # Backward with gradient scaling
        scaler.scale(loss).backward()
        scaler.unscale_(optimizer)
        torch.nn.utils.clip_grad_norm_(model.parameters(), config.gradient_clip_val)
        scaler.step(optimizer)
        scaler.update()
        
        # Accumulate losses
        for k, v in loss_dict.items():
            total_losses[k] += v * images.size(0)
        
        # Compute metrics
        if batch_idx % config.log_interval == 0:
            with torch.no_grad():
                metrics = compute_metrics(predictions, targets)
                pbar.set_postfix({
                    'loss': f"{loss.item():.4f}",
                    'cat_acc': f"{metrics.get('category_acc', 0):.3f}"
                })
    
    # Average over dataset
    num_samples = len(dataloader.dataset)
    avg_losses = {k: v / num_samples for k, v in total_losses.items()}
    
    return avg_losses


@torch.no_grad()
def validate(
    model: nn.Module,
    dataloader: DataLoader,
    criterion: MultiTaskLoss,
    device: str
) -> Tuple[Dict[str, float], Dict[str, float]]:
    """Validate model"""
    model.eval()
    total_losses = {k: 0.0 for k in ['total', 'category', 'colors', 'pattern', 'material', 'seasons', 'occasions']}
    total_metrics = {
        'category_acc': 0.0, 'pattern_acc': 0.0, 'material_acc': 0.0,
        'colors_exact': 0.0, 'seasons_exact': 0.0, 'occasions_exact': 0.0
    }
    
    for images, targets in tqdm(dataloader, desc="Validating"):
        images = images.to(device)
        targets = {k: v.to(device) for k, v in targets.items()}
        
        predictions = model(images)
        loss, loss_dict = criterion(predictions, targets)
        
        # Accumulate losses
        batch_size = images.size(0)
        for k, v in loss_dict.items():
            total_losses[k] += v * batch_size
        
        # Accumulate metrics
        metrics = compute_metrics(predictions, targets)
        for k, v in metrics.items():
            total_metrics[k] += v * batch_size
    
    # Average
    num_samples = len(dataloader.dataset)
    avg_losses = {k: v / num_samples for k, v in total_losses.items()}
    avg_metrics = {k: v / num_samples for k, v in total_metrics.items()}
    
    return avg_losses, avg_metrics


def main():
    # Load config
    config = TrainingConfig()
    
    # Auto-detect device
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    config.device = str(device)
    print(f"Using device: {device}")
    
    # Create output directory
    output_path = Path(config.output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    config.save(output_path / 'config.json')
    
    # Create datasets
    print("Loading datasets...")
    train_ds = MultiLabelFashionDataset(config.train_csv, config, is_train=True)
    val_ds = MultiLabelFashionDataset(config.val_csv, config, is_train=False)
    
    train_dl = DataLoader(
        train_ds,
        batch_size=config.batch_size,
        shuffle=True,
        num_workers=config.num_workers,
        pin_memory=True,
        drop_last=True
    )
    val_dl = DataLoader(
        val_ds,
        batch_size=config.batch_size,
        shuffle=False,
        num_workers=config.num_workers,
        pin_memory=True
    )
    
    print(f"Train samples: {len(train_ds)}, Val samples: {len(val_ds)}")
    
    # Create model
    print(f"Creating model: {config.model_name}")
    model = MultiHeadAttributeModel(config).to(device)
    criterion = MultiTaskLoss(config).to(device)
    
    # Optimizer and scheduler
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=config.learning_rate,
        weight_decay=config.weight_decay
    )
    
    # Cosine annealing with warmup
    scheduler = torch.optim.lr_scheduler.CosineAnnealingWarmRestarts(
        optimizer,
        T_0=10,
        T_mult=2,
        eta_min=1e-6
    )
    
    # Mixed precision scaler
    scaler = GradScaler(enabled=config.mixed_precision)
    
    # Training loop
    best_val_acc = 0.0
    patience_counter = 0
    
    for epoch in range(config.num_epochs):
        print(f"\n{'='*60}")
        print(f"Epoch {epoch+1}/{config.num_epochs}")
        print(f"Learning rate: {optimizer.param_groups[0]['lr']:.6f}")
        
        # Train
        train_losses = train_epoch(
            model, train_dl, criterion, optimizer, scaler, device, config, epoch
        )
        
        # Validate
        val_losses, val_metrics = validate(model, val_dl, criterion, device)
        
        # Learning rate scheduling
        scheduler.step()
        
        # Print results
        print(f"\nTrain Loss: {train_losses['total']:.4f}")
        print(f"Val Loss: {val_losses['total']:.4f}")
        print(f"Val Metrics:")
        for k, v in val_metrics.items():
            print(f"  {k}: {v:.4f}")
        
        # Save checkpoint
        val_acc = val_metrics['category_acc']  # Primary metric
        
        if val_acc > best_val_acc + config.min_delta:
            best_val_acc = val_acc
            patience_counter = 0
            
            checkpoint = {
                'epoch': epoch,
                'model_state_dict': model.state_dict(),
                'optimizer_state_dict': optimizer.state_dict(),
                'scheduler_state_dict': scheduler.state_dict(),
                'val_metrics': val_metrics,
                'config': config.to_dict()
            }
            
            torch.save(checkpoint, output_path / 'best_model.pth')
            print(f"✓ New best model saved! Val Acc: {val_acc:.4f}")
        else:
            patience_counter += 1
            print(f"No improvement ({patience_counter}/{config.patience})")
        
        # Early stopping
        if patience_counter >= config.patience:
            print(f"\nEarly stopping triggered after {epoch+1} epochs")
            break
        
        # Save periodic checkpoint
        if (epoch + 1) % config.save_interval == 0:
            torch.save(model.state_dict(), output_path / f'model_epoch_{epoch+1}.pth')
    
    print(f"\nTraining complete! Best validation accuracy: {best_val_acc:.4f}")
    print(f"Model saved to: {output_path}")


if __name__ == '__main__':
    main()
