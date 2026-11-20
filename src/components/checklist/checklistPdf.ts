const BRAND_ACCENT = "#03C03C";

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

/** iOS: Web Share API (Save to Files, AirDrop, etc.) or fallback to opening blob URL in new tab. */
function deliverPdfForIOS(blob: Blob): void {
  const file = new File([blob], "DormCheck_Essentials_List.pdf", {
    type: "application/pdf",
  });
  const filesToShare: File[] = [file];
  if (
    typeof navigator !== "undefined" &&
    navigator.canShare &&
    navigator.canShare({ files: filesToShare })
  ) {
    navigator.share({ files: filesToShare, title: "DormCheck Essentials List" }).catch(() => {
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, "_blank");
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    });
  } else {
    const blobUrl = URL.createObjectURL(blob);
    window.open(blobUrl, "_blank");
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  }
}

export { BRAND_ACCENT, isIOS, deliverPdfForIOS };
