export function appendTailMainImages(productMainImages = [], template = null) {
  const productImages = Array.isArray(productMainImages)
    ? productMainImages.map((image, index) => ({
        ...image,
        source: "product",
        sequence: index + 1,
      }))
    : [];
  const tailImages = Array.isArray(template?.images)
    ? template.images.map((image, index) => ({
        ...image,
        source: "tail-template",
        templateId: template.id || "",
        templateName: template.name || "",
        sequence: productImages.length + index + 1,
      }))
    : [];

  return {
    images: [...productImages, ...tailImages],
    productCount: productImages.length,
    tailCount: tailImages.length,
  };
}
