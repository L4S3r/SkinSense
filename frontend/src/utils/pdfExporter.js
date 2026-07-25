import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

export async function downloadReportAsPDF(report, pdfTemplateRef, setIsExportingPdf) {
  if (!report || !pdfTemplateRef?.current) return;

  setIsExportingPdf(true);

  try {
    const exportElement = pdfTemplateRef.current;

    const reportCanvas = await html2canvas(exportElement, {
      backgroundColor: "#FAFBF8",
      scale: 2,
      useCORS: true,
      logging: false,
    });

    const imgData = reportCanvas.toDataURL("image/png");

    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });

    // A4 dimensions are 210mm x 297mm
    pdf.addImage(imgData, "PNG", 0, 0, 210, 297);

    // Add interactive click targets in generated PDF
    pdf.link(12, 10, 55, 18, { url: "https://meloniq-eta.vercel.app/" });
    pdf.link(12, 275, 186, 12, { url: "https://meloniq-eta.vercel.app/" });

    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    const formattedDate = `${year}-${month}-${day}`;

    pdf.save(`meloniq-skin-report-${formattedDate}.pdf`);
  } catch (err) {
    console.error("PDF export failed:", err);
    alert("Couldn't generate the PDF document. Please try again.");
  } finally {
    setIsExportingPdf(false);
  }
}
