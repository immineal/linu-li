/* The pdf.js worker, with assets/js/pdfjs-lesbar.js ahead of it. Imports run
   in order, so the stream is readable before pdf.js needs it. */
import './pdfjs-lesbar.js';
import '../vendor/pdfjs-6.3.289/pdf.worker.min.js';
