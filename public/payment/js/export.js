window.PayExport = {

  async exportPDF() {
    // Dynamically load jsPDF and html2canvas if not already loaded
    if (!window.jspdf) {
      await Promise.all([
        loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js'),
        loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js')
      ]);
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;
    let y = margin;

    // Fetch data
    const [dashRes, payRes] = await Promise.all([
      fetch('/payment/api/dashboard').then(r => r.json()),
      fetch('/payment/api/payments').then(r => r.json())
    ]);

    const data = dashRes;
    const payments = payRes.payments || [];

    // Title
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text('Loan Payment Report', margin, y);
    y += 10;

    // Date
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    doc.text(`Generated: ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`, margin, y);
    y += 12;

    // Summary box
    doc.setDrawColor(99, 102, 241); // indigo
    doc.setLineWidth(0.5);
    doc.roundedRect(margin, y, pageWidth - margin * 2, 35, 3, 3);
    y += 8;

    doc.setFontSize(11);
    doc.setTextColor(0);
    doc.setFont('helvetica', 'bold');

    const col1 = margin + 5;
    const col2 = pageWidth / 2 + 5;

    doc.text('Outstanding Balance:', col1, y);
    doc.setFont('helvetica', 'normal');
    doc.text(`£${Number(data.summary.outstandingBalance).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`, col1 + 50, y);

    doc.setFont('helvetica', 'bold');
    doc.text('Total Paid:', col2, y);
    doc.setFont('helvetica', 'normal');
    doc.text(`£${Number(data.summary.totalPaid).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`, col2 + 30, y);
    y += 8;

    doc.setFont('helvetica', 'bold');
    doc.text('Total Interest:', col1, y);
    doc.setFont('helvetica', 'normal');
    doc.text(`£${Number(data.summary.totalInterest).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`, col1 + 50, y);

    doc.setFont('helvetica', 'bold');
    doc.text('Progress:', col2, y);
    doc.setFont('helvetica', 'normal');
    doc.text(`${data.summary.progressPercent}%`, col2 + 30, y);
    y += 8;

    doc.setFont('helvetica', 'bold');
    doc.text('Loan Amount:', col1, y);
    doc.setFont('helvetica', 'normal');
    doc.text(`£${Number(data.loan.originalAmount).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`, col1 + 50, y);

    doc.setFont('helvetica', 'bold');
    doc.text('Interest Rate:', col2, y);
    doc.setFont('helvetica', 'normal');
    doc.text(`${(data.loan.annualRate * 100).toFixed(1)}%`, col2 + 30, y);
    y += 15;

    // Payment table
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0);
    doc.text('Payment History', margin, y);
    y += 8;

    // Table headers
    const colWidths = [28, 25, 30, 30, 30, 22];
    const colHeaders = ['Date', 'Amount', 'Interest', 'Capital', 'Balance', 'Status'];
    const colX = [margin];
    for (let i = 1; i < colWidths.length; i++) colX.push(colX[i-1] + colWidths[i-1]);

    doc.setFillColor(99, 102, 241);
    doc.rect(margin, y, pageWidth - margin * 2, 7, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255);
    colHeaders.forEach((h, i) => doc.text(h, colX[i] + 2, y + 5));
    y += 9;

    // Table rows
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0);
    doc.setFontSize(8);

    const breakdowns = data.chartData?.paymentBreakdowns || [];

    for (const payment of payments) {
      if (y > 270) {
        doc.addPage();
        y = margin;
      }

      const bd = breakdowns.find(b => b.paymentId === payment.id);
      const row = [
        payment.payment_date,
        `£${Number(payment.amount).toFixed(2)}`,
        bd ? `£${Number(bd.interestPortion).toFixed(2)}` : '-',
        bd ? `£${Number(bd.capitalPortion).toFixed(2)}` : '-',
        bd ? `£${Number(bd.balanceAfter).toFixed(2)}` : '-',
        payment.status
      ];

      if (payments.indexOf(payment) % 2 === 0) {
        doc.setFillColor(245, 245, 255);
        doc.rect(margin, y - 3, pageWidth - margin * 2, 6, 'F');
      }

      row.forEach((cell, i) => doc.text(cell, colX[i] + 2, y));
      y += 6;
    }

    // Save
    doc.save(`loan-report-${new Date().toISOString().split('T')[0]}.pdf`);
  },

  exportCSV() {
    window.location.href = '/payment/api/export?format=csv';
  }
};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}
