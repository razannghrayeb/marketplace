"""
Export trained model to ONNX and create inference wrapper
"""
import torch
import torch.nn as nn
from pathlib import Path
import json
import numpy as np
from PIL import Image
from torchvision import transforms

from train_improved import MultiHeadAttributeModel
from config import (
    TrainingConfig, CATEGORY_NAMES, COLOR_NAMES, 
    PATTERN_NAMES, MATERIAL_NAMES, SEASON_NAMES, OCCASION_NAMES
)


class AttributeExtractor:
    """Inference wrapper for attribute extraction"""
    
    def __init__(self, checkpoint_path: str, device: str = 'cuda'):
        self.device = torch.device(device if torch.cuda.is_available() else 'cpu')
        
        # Load checkpoint
        checkpoint = torch.load(checkpoint_path, map_location=self.device)
        config_dict = checkpoint.get('config', {})
        
        # Reconstruct config
        self.config = TrainingConfig()
        for k, v in config_dict.items():
            if hasattr(self.config, k):
                setattr(self.config, k, v)
        
        # Load model
        self.model = MultiHeadAttributeModel(self.config)
        self.model.load_state_dict(checkpoint['model_state_dict'])
        self.model.to(self.device)
        self.model.eval()
        
        # Image preprocessing
        self.transform = transforms.Compose([
            transforms.Resize((self.config.img_size, self.config.img_size)),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
        ])
        
        print(f"Model loaded from {checkpoint_path}")
        print(f"Validation metrics: {checkpoint.get('val_metrics', {})}")
    
    @torch.no_grad()
    def extract_attributes(self, image_path: str, threshold: float = 0.5) -> dict:
        """
        Extract all attributes from an image
        
        Args:
            image_path: Path to image file
            threshold: Confidence threshold for multi-label predictions
            
        Returns:
            Dictionary with extracted attributes and confidences
        """
        # Load and preprocess image
        img = Image.open(image_path).convert('RGB')
        img_tensor = self.transform(img).unsqueeze(0).to(self.device)
        
        # Forward pass
        predictions = self.model(img_tensor)
        
        # Parse predictions
        results = {}
        
        # Category (single-label)
        category_probs = torch.softmax(predictions['category'], dim=1)[0]
        category_idx = category_probs.argmax().item()
        results['category'] = {
            'name': CATEGORY_NAMES[category_idx] if category_idx < len(CATEGORY_NAMES) else 'unknown',
            'confidence': category_probs[category_idx].item(),
            'top3': [
                {
                    'name': CATEGORY_NAMES[i] if i < len(CATEGORY_NAMES) else f'cat_{i}',
                    'confidence': category_probs[i].item()
                }
                for i in category_probs.topk(3).indices.tolist()
            ]
        }
        
        # Colors (multi-label)
        color_probs = torch.sigmoid(predictions['colors'])[0]
        color_mask = color_probs > threshold
        results['colors'] = [
            {
                'name': COLOR_NAMES[i] if i < len(COLOR_NAMES) else f'color_{i}',
                'confidence': color_probs[i].item()
            }
            for i in torch.where(color_mask)[0].tolist()
        ]
        
        # Pattern (single-label)
        pattern_probs = torch.softmax(predictions['pattern'], dim=1)[0]
        pattern_idx = pattern_probs.argmax().item()
        results['pattern'] = {
            'name': PATTERN_NAMES[pattern_idx] if pattern_idx < len(PATTERN_NAMES) else 'unknown',
            'confidence': pattern_probs[pattern_idx].item()
        }
        
        # Material (single-label)
        material_probs = torch.softmax(predictions['material'], dim=1)[0]
        material_idx = material_probs.argmax().item()
        results['material'] = {
            'name': MATERIAL_NAMES[material_idx] if material_idx < len(MATERIAL_NAMES) else 'unknown',
            'confidence': material_probs[material_idx].item()
        }
        
        # Seasons (multi-label)
        season_probs = torch.sigmoid(predictions['seasons'])[0]
        season_mask = season_probs > threshold
        results['seasons'] = [
            {
                'name': SEASON_NAMES[i] if i < len(SEASON_NAMES) else f'season_{i}',
                'confidence': season_probs[i].item()
            }
            for i in torch.where(season_mask)[0].tolist()
        ]
        
        # Occasions (multi-label)
        occasion_probs = torch.sigmoid(predictions['occasions'])[0]
        occasion_mask = occasion_probs > threshold
        results['occasions'] = [
            {
                'name': OCCASION_NAMES[i] if i < len(OCCASION_NAMES) else f'occasion_{i}',
                'confidence': occasion_probs[i].item()
            }
            for i in torch.where(occasion_mask)[0].tolist()
        ]
        
        return results
    
    def batch_extract(self, image_paths: list, threshold: float = 0.5) -> list:
        """Extract attributes from multiple images"""
        return [self.extract_attributes(path, threshold) for path in image_paths]


def export_to_onnx(checkpoint_path: str, output_path: str, opset_version: int = 14):
    """
    Export model to ONNX format for production inference
    
    Args:
        checkpoint_path: Path to PyTorch checkpoint
        output_path: Output path for ONNX model
        opset_version: ONNX opset version
    """
    device = torch.device('cpu')  # Export on CPU for compatibility
    
    # Load model
    checkpoint = torch.load(checkpoint_path, map_location=device)
    config_dict = checkpoint.get('config', {})
    
    config = TrainingConfig()
    for k, v in config_dict.items():
        if hasattr(config, k):
            setattr(config, k, v)
    
    model = MultiHeadAttributeModel(config)
    model.load_state_dict(checkpoint['model_state_dict'])
    model.eval()
    
    # Dummy input
    dummy_input = torch.randn(1, 3, config.img_size, config.img_size)
    
    # Export
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    torch.onnx.export(
        model,
        dummy_input,
        str(output_path),
        export_params=True,
        opset_version=opset_version,
        do_constant_folding=True,
        input_names=['image'],
        output_names=['category', 'colors', 'pattern', 'material', 'seasons', 'occasions'],
        dynamic_axes={
            'image': {0: 'batch_size'},
            'category': {0: 'batch_size'},
            'colors': {0: 'batch_size'},
            'pattern': {0: 'batch_size'},
            'material': {0: 'batch_size'},
            'seasons': {0: 'batch_size'},
            'occasions': {0: 'batch_size'}
        }
    )
    
    # Save metadata
    metadata = {
        'config': config.to_dict(),
        'category_names': CATEGORY_NAMES,
        'color_names': COLOR_NAMES,
        'pattern_names': PATTERN_NAMES,
        'material_names': MATERIAL_NAMES,
        'season_names': SEASON_NAMES,
        'occasion_names': OCCASION_NAMES,
        'input_size': [config.img_size, config.img_size],
        'mean': [0.485, 0.456, 0.406],
        'std': [0.229, 0.224, 0.225],
        'opset_version': opset_version
    }
    
    metadata_path = output_path.with_suffix('.json')
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2)
    
    print(f"✓ Model exported to {output_path}")
    print(f"✓ Metadata saved to {metadata_path}")
    
    # Verify ONNX model
    import onnx
    onnx_model = onnx.load(str(output_path))
    onnx.checker.check_model(onnx_model)
    print("✓ ONNX model verified successfully")


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='Export or test attribute extraction model')
    parser.add_argument('--checkpoint', type=str, required=True, help='Path to checkpoint')
    parser.add_argument('--mode', type=str, choices=['test', 'export'], default='test')
    parser.add_argument('--image', type=str, help='Test image path (for test mode)')
    parser.add_argument('--output', type=str, default='models/attribute_extractor/model.onnx', 
                        help='Output ONNX path (for export mode)')
    
    args = parser.parse_args()
    
    if args.mode == 'test':
        if not args.image:
            print("Error: --image required for test mode")
            return
        
        # Test inference
        extractor = AttributeExtractor(args.checkpoint)
        results = extractor.extract_attributes(args.image)
        
        print("\n" + "="*60)
        print("Extracted Attributes:")
        print("="*60)
        print(json.dumps(results, indent=2))
    
    elif args.mode == 'export':
        # Export to ONNX
        export_to_onnx(args.checkpoint, args.output)


if __name__ == '__main__':
    main()
