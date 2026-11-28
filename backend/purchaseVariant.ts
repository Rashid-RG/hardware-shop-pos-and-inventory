export function purchaseVariant<T extends { id: string }>(
  variants: T[], variantId: string | null | undefined, productName: string, legacy = false
): T | undefined {
  if (!variantId && !variants.length) return undefined;
  if (variantId) {
    const variant = variants.find(item => item.id === variantId);
    if (variant) return variant;
    throw new Error('The ordered variant is no longer available for ' + productName);
  }
  if (legacy && variants.length === 1) return variants[0];
  throw new Error('Select the exact variant for ' + productName + ' on a new purchase order before receiving it.');
}
