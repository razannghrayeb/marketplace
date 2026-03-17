"""Image preprocessing module for improved YOLO detection.

Provides optional preprocessing steps to improve detection accuracy
on cluttered backgrounds:
- Contrast enhancement (separates foreground from background)
- Sharpness enhancement (improves edge detection)
- Bilateral filtering (reduces noise while preserving edges)

Usage:
    from image_preprocessor import preprocess_for_detection, PreprocessingConfig

    config = PreprocessingConfig(enhance_contrast=True, enhance_sharpness=True)
    processed_image = preprocess_for_detection(image, config)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Tuple, Optional

import cv2
import numpy as np
from PIL import Image, ImageEnhance


@dataclass
class PreprocessingConfig:
    """Configuration for image preprocessing.

    Attributes:
        enhance_contrast: Apply contrast enhancement (default: True)
        enhance_sharpness: Apply sharpness enhancement (default: True)
        bilateral_filter: Apply bilateral filtering for noise reduction (default: True)
        contrast_factor: Contrast enhancement factor (default: 1.15)
        sharpness_factor: Sharpness enhancement factor (default: 1.2)
        bilateral_d: Diameter of each pixel neighborhood for bilateral filter (default: 9)
        bilateral_sigma_color: Filter sigma in the color space (default: 75)
        bilateral_sigma_space: Filter sigma in the coordinate space (default: 75)
    """

    enhance_contrast: bool = True
    enhance_sharpness: bool = True
    bilateral_filter: bool = True
    contrast_factor: float = 1.15
    sharpness_factor: float = 1.2
    bilateral_d: int = 9
    bilateral_sigma_color: float = 75.0
    bilateral_sigma_space: float = 75.0


def preprocess_for_detection(
    image: Image.Image,
    config: Optional[PreprocessingConfig] = None,
) -> Tuple[Image.Image, dict]:
    """Preprocess image to improve YOLO detection on cluttered backgrounds.

    Args:
        image: PIL Image in RGB mode
        config: Preprocessing configuration (uses defaults if None)

    Returns:
        Tuple of (processed_image, metadata_dict)

    Example:
        config = PreprocessingConfig(enhance_contrast=True)
        processed, metadata = preprocess_for_detection(image, config)
    """
    if config is None:
        config = PreprocessingConfig()

    metadata = {
        "original_size": image.size,
        "preprocessing_applied": [],
    }

    # Ensure RGB mode
    if image.mode != "RGB":
        image = image.convert("RGB")

    # 1. Contrast enhancement - helps separate foreground from background
    if config.enhance_contrast:
        enhancer = ImageEnhance.Contrast(image)
        image = enhancer.enhance(config.contrast_factor)
        metadata["preprocessing_applied"].append(
            f"contrast_enhancement:{config.contrast_factor}"
        )

    # 2. Sharpness enhancement - improves edge detection
    if config.enhance_sharpness:
        enhancer = ImageEnhance.Sharpness(image)
        image = enhancer.enhance(config.sharpness_factor)
        metadata["preprocessing_applied"].append(
            f"sharpness_enhancement:{config.sharpness_factor}"
        )

    # 3. Bilateral filter - reduces noise while preserving edges
    # This is particularly effective for cluttered backgrounds
    if config.bilateral_filter:
        img_array = np.array(image)
        img_filtered = cv2.bilateralFilter(
            img_array,
            config.bilateral_d,
            config.bilateral_sigma_color,
            config.bilateral_sigma_space,
        )
        image = Image.fromarray(img_filtered)
        metadata["preprocessing_applied"].append(
            f"bilateral_filter:d={config.bilateral_d}"
        )

    return image, metadata


def compute_saliency_mask(image: Image.Image) -> np.ndarray:
    """Compute saliency map to identify likely foreground regions.

    Can be used for attention-guided detection or filtering.

    Args:
        image: PIL Image in RGB mode

    Returns:
        Saliency map as uint8 numpy array (0-255)
    """
    img_array = np.array(image)
    if len(img_array.shape) == 3 and img_array.shape[2] == 3:
        gray = cv2.cvtColor(img_array, cv2.COLOR_RGB2GRAY)
    else:
        gray = img_array

    # Use spectral residual saliency
    saliency = cv2.saliency.StaticSaliencySpectralResidual_create()
    success, saliency_map = saliency.computeSaliency(gray)

    if success:
        return (saliency_map * 255).astype(np.uint8)
    return np.ones_like(gray, dtype=np.uint8) * 128


def enhance_for_small_items(image: Image.Image) -> Image.Image:
    """Additional enhancement for detecting small items.

    Applies higher sharpness and local contrast enhancement
    to help detect small accessories, jewelry, etc.

    Args:
        image: PIL Image in RGB mode

    Returns:
        Enhanced PIL Image
    """
    # Higher sharpness for small item edges
    enhancer = ImageEnhance.Sharpness(image)
    image = enhancer.enhance(1.5)

    # Local adaptive histogram equalization via CLAHE
    img_array = np.array(image)
    lab = cv2.cvtColor(img_array, cv2.COLOR_RGB2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)

    # Apply CLAHE to L channel
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_channel = clahe.apply(l_channel)

    # Merge channels back
    lab = cv2.merge([l_channel, a_channel, b_channel])
    enhanced = cv2.cvtColor(lab, cv2.COLOR_LAB2RGB)

    return Image.fromarray(enhanced)
