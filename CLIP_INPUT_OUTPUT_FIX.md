# CLIP Model Input/Output Name Compatibility Fix

## Problem
The reindex-embeddings script was failing with:
```
Error: input 'pixel_values' is missing in 'feeds'
```

This happened because different CLIP ONNX models use different input/output names:

| Model Source | Input Name | Output Name |
|--------------|------------|-------------|
| **Old models** (rocca/openai-clip-js) | `input` | `output` |
| **New models** (Xenova HuggingFace) | `pixel_values` | `image_embeds` |

The code was hardcoded to use `input`, which failed with the new Xenova models.

## Solution
Updated `src/lib/image/clip.ts` to dynamically read input/output names from ONNX session metadata:

### Before (Hardcoded):
```typescript
// getImageEmbedding()
const results = await imageSession.run({ input: inputTensor });

// getTextEmbedding()
const results = await textSession.run({ input: inputTensor });
```

### After (Dynamic):
```typescript
// getImageEmbedding()
const inputName = imageSession.inputNames[0];
const feeds: Record<string, ort.Tensor> = { [inputName]: inputTensor };
const results = await imageSession.run(feeds);

// getTextEmbedding()
const inputName = textSession.inputNames[0];
const feeds: Record<string, ort.Tensor> = { [inputName]: inputTensor };
const results = await textSession.run(feeds);
```

This makes the code work with **both** old and new ONNX models automatically.

## Testing
Created `scripts/test-clip-embedding.ts` to verify:

```bash
# Test with new Fashion-CLIP (Xenova)
npx tsx scripts/test-clip-embedding.ts

# Test with old ViT-B/32 (rocca)
CLIP_MODEL_TYPE=vit-b-32 npx tsx scripts/test-clip-embedding.ts
```

✅ Both tests pass - embeddings are properly normalized (L2 norm = 1.0)
✅ Fashion-CLIP generates 512-dimensional embeddings correctly
✅ Legacy ViT-B/32 still works (backward compatible)

## Model Status

| Model | Status | Image Model Size | Text Model Size |
|-------|--------|------------------|-----------------|
| **Fashion-CLIP** (Xenova/clip-vit-base-patch32) | ✅ Working | 336 MB | 243 MB |
| **ViT-B/32** (rocca/openai-clip-js) | ✅ Working | 351 MB | - |
| **ViT-L/14** (Xenova/clip-vit-large-patch14) | ❌ Corrupted | 671 MB (incomplete) | 89 MB (incomplete) |

### To Fix ViT-L/14:
1. Stop any running Node processes that might have the model files open:
   ```bash
   taskkill /F /IM node.exe
   ```

2. Delete corrupted files:
   ```bash
   rm models/clip-image-vit-l-14.onnx models/clip-text-vit-l-14.onnx
   ```

3. Re-download with the fixed script:
   ```bash
   npx tsx scripts/download-clip.ts --model vit-l-14
   ```

## Files Changed
1. **`scripts/download-clip.ts`** - Fixed download function and URLs
2. **`src/lib/image/clip.ts`** - Added dynamic input/output name support
3. **`scripts/test-clip-embedding.ts`** - New test file to verify embeddings work

## Impact
- ✅ Fashion-CLIP now works correctly with proper 512-dim embeddings
- ✅ All existing old models still work (backward compatible)
- ✅ Reindex-embeddings script should now complete successfully
- ✅ Image search will use properly generated embeddings
