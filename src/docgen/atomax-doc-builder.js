/**
 * atomax-doc-builder.js
 *
 * Builds Atomax-UK Ltd Word documents that match the house format exactly:
 * logo header table with live Page X of Y fields, cover block, Notice,
 * Project Details / Document Approval / Revision History tables, an auto
 * Table of Contents, and numbered heading sections (1 / 1.1 / 1.1.1).
 *
 * Usage: see generate.js for a full worked example, or require this module
 * directly and call buildAtomaxDoc(config) to get a docx Document object.
 */

const {
  Document, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  Header, ImageRun, TableOfContents, PageNumber, LevelFormat,
  VerticalAlign,
} = require("docx");

// ---------------------------------------------------------------------------
// Brand constants — do not change without checking against the reference
// files in ../assets/ (reference-template.docx / reference-example.docx)
// ---------------------------------------------------------------------------

const BRAND_COLOR = "64727A";       // heading / title slate grey
const SHADING_GREY = "D9D9D9";      // table label/header cell shading
const FONT_HEADING = "Futura Medium";
const FONT_BODY = "Futura-Book";

// Default cell padding for body tables. Without this, docx-js leaves the
// left/right inset at 0 and text sits jammed against the cell border, which
// reads as cramped. 144 twips (~0.25 cm) each side gives text clear breathing
// room; 40 twips top/bottom keeps rows from feeling tight vertically without
// bloating short tables. Applied to every body table via the Table `margins`
// option so the spacing is consistent everywhere rather than set per-cell.
const CELL_MARGINS = { top: 40, bottom: 40, left: 144, right: 144, marginUnitType: WidthType.DXA };

const PAGE = { width: 11906, height: 16838 }; // A4 in twips
// top margin must clear the 4-row running header (which starts at `header`
// distance below the page edge) with a comfortable gap — Atomax requires at
// least 4 cm. 2340 twips ≈ 4.13 cm (1 cm ≈ 567 twips).
const MARGINS = { top: 2340, right: 1134, bottom: 567, left: 1134, header: 454, footer: 312 };

const DEFAULT_NOTICE = [
  "This document and its contents have been prepared and are intended for use by the party which commissioned it. It should not be relied upon by any other party or used for any other purpose.",
  "This document contains confidential information and proprietary intellectual property. It should not be shown to other parties without consent from us and the party which commissioned it.",
];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function noBorder() {
  return { style: BorderStyle.NONE, size: 0, color: "auto" };
}

function thinBorder() {
  return { style: BorderStyle.SINGLE, size: 4, color: "000000" };
}

function allBorders() {
  const b = thinBorder();
  return { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b };
}

function greyShading() {
  return { type: ShadingType.CLEAR, color: "auto", fill: SHADING_GREY };
}

function headingRun(text, opts = {}) {
  return new TextRun({ text, font: FONT_HEADING, color: BRAND_COLOR, bold: !!opts.bold, size: opts.size });
}

function bodyRun(text, opts = {}) {
  return new TextRun({ text, font: FONT_BODY, bold: !!opts.bold, size: opts.size || 20 });
}

/** A table cell with our standard grey label styling. */
function labelCell(text, widthDXA) {
  return new TableCell({
    width: { size: widthDXA, type: WidthType.DXA },
    shading: greyShading(),
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ children: [bodyRun(text, { bold: true })] })],
  });
}

function valueCell(text, widthDXA) {
  return new TableCell({
    width: { size: widthDXA, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ children: [bodyRun(String(text ?? ""))] })],
  });
}

function headerCell(text, widthDXA, align = AlignmentType.LEFT) {
  return new TableCell({
    width: { size: widthDXA, type: WidthType.DXA },
    shading: greyShading(),
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ alignment: align, children: [bodyRun(text, { bold: true })] })],
  });
}

function dataCell(text, widthDXA, align = AlignmentType.LEFT) {
  return new TableCell({
    width: { size: widthDXA, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ alignment: align, children: [bodyRun(String(text ?? ""))] })],
  });
}

// ---------------------------------------------------------------------------
// Styles + numbering (fonts, heading sizes/colours, TOC style, heading
// multilevel list producing 1 / 1.1 / 1.1.1 numbering)
// ---------------------------------------------------------------------------

const numbering = {
  config: [
    {
      reference: "atomax-heading-numbering",
      levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: "%1", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 432, hanging: 432 } } } },
        { level: 1, format: LevelFormat.DECIMAL, text: "%1.%2", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 576, hanging: 576 } } } },
        { level: 2, format: LevelFormat.DECIMAL, text: "%1.%2.%3", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 720 } } } },
      ],
    },
    {
      reference: "atomax-bullet-list",
      levels: [
        { level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 432, hanging: 216 } } } },
      ],
    },
  ],
};

function documentStyles() {
  return {
    default: {
      document: {
        run: { font: FONT_BODY, size: 20 },
        // widowControl stops a paragraph leaving a single line stranded at
        // the top/bottom of a page.
        paragraph: { spacing: { after: 160, line: 259, lineRule: "auto" }, widowControl: true },
      },
    },
    paragraphStyles: [
      // keepNext keeps each heading glued to the content that follows it so a
      // heading never sits alone at the foot of a page.
      {
        id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: FONT_HEADING, color: BRAND_COLOR, size: 32, bold: false },
        paragraph: { spacing: { before: 240, after: 160 }, keepNext: true, keepLines: true, numbering: { reference: "atomax-heading-numbering", level: 0 } },
      },
      {
        id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: FONT_HEADING, color: BRAND_COLOR, size: 28, bold: false },
        paragraph: { spacing: { before: 200, after: 120 }, keepNext: true, keepLines: true, numbering: { reference: "atomax-heading-numbering", level: 1 } },
      },
      {
        id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: FONT_HEADING, color: BRAND_COLOR, size: 24, bold: false },
        paragraph: { spacing: { before: 160, after: 100 }, keepNext: true, keepLines: true, numbering: { reference: "atomax-heading-numbering", level: 2 } },
      },
      {
        id: "Heading1NoTOC", name: "Heading 1 No TOC", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: FONT_HEADING, color: BRAND_COLOR, size: 32, bold: false },
        paragraph: { spacing: { before: 240, after: 160 }, keepNext: true, keepLines: true },
      },
      // Appendix heading: looks like Heading 1 but is NOT auto-numbered. The
      // outlineLevel in the STYLE (not direct formatting) is what makes Word's
      // TOC field pick it up, and it is also mapped explicitly into the TOC via
      // a \t switch (see buildTOC). Result: listed in Contents, no "6"/"7".
      {
        id: "AppendixHeading", name: "AppendixHeading", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: FONT_HEADING, color: BRAND_COLOR, size: 32, bold: false },
        paragraph: { spacing: { before: 240, after: 160 }, keepNext: true, keepLines: true, outlineLevel: 0 },
      },
      {
        id: "TOCHeading", name: "TOC Heading", basedOn: "Heading1NoTOC", next: "Normal", quickFormat: true,
        run: { font: FONT_BODY, color: "auto", size: 24 },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Running header: logo | document title | Doc No. | Rev | Date | Page X of Y
// ---------------------------------------------------------------------------

function buildRunningHeader({ documentTitle, docNumber, revision, date, logoPath }) {
  const fs = require("fs");
  const logoData = fs.readFileSync(logoPath);

  const col = { logo: 2439, title: 4250, label: 1017, value: 2326 };

  const row = (cells) => new TableRow({ cantSplit: true, children: cells });

  const fieldValueCell = (children, widthDXA) => new TableCell({
    width: { size: widthDXA, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    children,
  });

  const smallLabel = (text) => new TableCell({
    width: { size: col.label, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ children: [bodyRun(text, { size: 16 })] })],
  });

  const smallValue = (text) => fieldValueCell([new Paragraph({ children: [bodyRun(text, { size: 16 })] })], col.value);

  const logoCell = new TableCell({
    width: { size: col.logo, type: WidthType.DXA },
    rowSpan: 4,
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new ImageRun({ data: logoData, type: "png", transformation: { width: 121, height: 27 } })],
    })],
  });

  const titleCell = new TableCell({
    width: { size: col.title, type: WidthType.DXA },
    rowSpan: 4,
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [bodyRun(documentTitle, { bold: true, size: 28 })],
    })],
  });

  const pageValueCell = fieldValueCell([
    new Paragraph({
      children: [
        new TextRun({ children: [PageNumber.CURRENT], font: FONT_BODY, size: 20 }),
        bodyRun("   of   ", { size: 16 }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT_BODY, size: 20 }),
      ],
    }),
  ], col.value);

  const table = new Table({
    width: { size: col.logo + col.title + col.label + col.value, type: WidthType.DXA },
    columnWidths: [col.logo, col.title, col.label, col.value],
    borders: allBorders(),
    rows: [
      row([logoCell, titleCell, smallLabel("Doc No."), smallValue(docNumber)]),
      row([smallLabel("Rev:"), smallValue(revision)]),
      row([smallLabel("Date:"), smallValue(date)]),
      row([smallLabel("Page:"), pageValueCell]),
    ],
  });

  // Rows 2-4 need the merged logo/title cells omitted (rowSpan handles it)
  // — docx-js infers this from rowSpan on row 1 as long as rows 2-4 only
  // supply the remaining columns, which is what we did above.

  return new Header({ children: [table] });
}

// ---------------------------------------------------------------------------
// Cover block, Notice, Project Details / Approval / Revision History tables
// ---------------------------------------------------------------------------

// Standalone cover page: big title, document ref and date, then a page
// break so the Notice starts on page 2.
function buildCoverBlock({ documentTitle, docRef, date }) {
  return [
    new Paragraph({ spacing: { before: 2000 }, children: [headingRun(documentTitle, { size: 44 })] }),
    new Paragraph({ spacing: { before: 400, after: 400 }, children: [headingRun(`Document Ref. ${docRef}`, { size: 32 })] }),
    new Paragraph({ children: [headingRun(date, { size: 32 })] }),
    new Paragraph({ children: [], pageBreakBefore: true }),
  ];
}

function buildNoticeSection(paragraphs = DEFAULT_NOTICE) {
  return [
    new Paragraph({ style: "Heading1NoTOC", children: [headingRun("Notice", { size: 32 })] }),
    ...paragraphs.map((t) => new Paragraph({ children: [bodyRun(t)] })),
  ];
}

/** Generic label/value info table (Project Details, equipment info, etc.) */
function buildInfoTable(rows, totalWidthDXA = 9638) {
  const labelW = Math.round(totalWidthDXA * 0.26);
  const valueW = totalWidthDXA - labelW;
  return new Table({
    width: { size: totalWidthDXA, type: WidthType.DXA },
    columnWidths: [labelW, valueW],
    borders: allBorders(),
    margins: CELL_MARGINS,
    rows: rows.map((r) => new TableRow({ children: [labelCell(r.label, labelW), valueCell(r.value, valueW)] })),
  });
}

function buildApprovalTable(rows, totalWidthDXA = 9638, blankRows = 4) {
  const w = [Math.round(totalWidthDXA * 0.12), Math.round(totalWidthDXA * 0.29), Math.round(totalWidthDXA * 0.29), totalWidthDXA - Math.round(totalWidthDXA * 0.12) - 2 * Math.round(totalWidthDXA * 0.29)];
  const headerRow = new TableRow({ tableHeader: true, children: [
    headerCell("Rev", w[0]), headerCell("Prepared by", w[1]), headerCell("Checked By", w[2]), headerCell("Approved by", w[3]),
  ] });
  const dataRows = rows.map((r) => new TableRow({ children: [
    dataCell(r.rev, w[0]), dataCell(r.preparedBy, w[1]), dataCell(r.checkedBy, w[2]), dataCell(r.approvedBy, w[3]),
  ] }));
  const blanks = Array.from({ length: blankRows }, () => new TableRow({ children: [
    dataCell("", w[0]), dataCell("", w[1]), dataCell("", w[2]), dataCell("", w[3]),
  ] }));
  return new Table({ width: { size: totalWidthDXA, type: WidthType.DXA }, columnWidths: w, borders: allBorders(), margins: CELL_MARGINS, rows: [headerRow, ...dataRows, ...blanks] });
}

function buildRevisionHistoryTable(rows, totalWidthDXA = 9638, blankRows = 4) {
  const w = [Math.round(totalWidthDXA * 0.12), Math.round(totalWidthDXA * 0.68), totalWidthDXA - Math.round(totalWidthDXA * 0.12) - Math.round(totalWidthDXA * 0.68)];
  const headerRow = new TableRow({ tableHeader: true, children: [
    headerCell("Rev", w[0]), headerCell("Description of Revision", w[1], AlignmentType.CENTER), headerCell("Date", w[2]),
  ] });
  const dataRows = rows.map((r) => new TableRow({ children: [
    dataCell(r.rev, w[0]), dataCell(r.description, w[1]), dataCell(r.date, w[2]),
  ] }));
  const blanks = Array.from({ length: blankRows }, () => new TableRow({ children: [
    dataCell("", w[0]), dataCell("", w[1]), dataCell("", w[2]),
  ] }));
  return new Table({ width: { size: totalWidthDXA, type: WidthType.DXA }, columnWidths: w, borders: allBorders(), margins: CELL_MARGINS, rows: [headerRow, ...dataRows, ...blanks] });
}

/** Generic grey-header data table for checklists / test results. */
function buildDataTable(headers, rows, totalWidthDXA = 9638, colWeights) {
  const weights = colWeights || headers.map(() => 1 / headers.length);
  const widths = weights.map((wt) => Math.round(totalWidthDXA * wt));
  widths[widths.length - 1] = totalWidthDXA - widths.slice(0, -1).reduce((a, b) => a + b, 0);
  // tableHeader repeats the grey header row on each page a long table spans;
  // cantSplit stops a single row breaking across a page boundary.
  const headerRow = new TableRow({ tableHeader: true, cantSplit: true, children: headers.map((h, i) => headerCell(h, widths[i], i === headers.length - 1 ? AlignmentType.LEFT : AlignmentType.LEFT)) });
  const dataRows = rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c, i) => dataCell(c, widths[i])) }));
  return new Table({ width: { size: totalWidthDXA, type: WidthType.DXA }, columnWidths: widths, borders: allBorders(), margins: CELL_MARGINS, rows: [headerRow, ...dataRows] });
}

function buildBulletList(items) {
  return items.map((text, i) => new Paragraph({
    numbering: { reference: "atomax-bullet-list", level: 0 },
    // Keep every item but the last glued to the next so a short list is not
    // split with a lone bullet stranded on the following page.
    keepNext: i < items.length - 1,
    keepLines: true,
    children: [bodyRun(text)],
  }));
}

function buildTOC() {
  return [
    new Paragraph({ style: "TOCHeading", children: [new TextRun({ text: "Contents", font: FONT_BODY, size: 24 })] }),
    // headingStyleRange "1-3" => \o "1-3" (numbered Heading 1-3); stylesWithLevels
    // => \t "AppendixHeading,1" so the un-numbered appendix headings are listed too.
    new TableOfContents("Contents", {
      hyperlink: true,
      headingStyleRange: "1-3",
      stylesWithLevels: [{ styleName: "AppendixHeading", level: 1 }],
    }),
    new Paragraph({ children: [], pageBreakBefore: true }),
  ];
}

// ---------------------------------------------------------------------------
// Section content helpers — turns a simple JSON description into Paragraphs/
// Tables so callers don't need to touch docx-js directly for common cases.
// ---------------------------------------------------------------------------

// Node types that must not be separated from the paragraph/heading that
// introduces them — if a heading + intro + one of these can't all fit on the
// current page, the whole block should page-break together rather than
// stranding the heading at the foot of the page.
const GLUE_TO_NEXT_TYPES = new Set(["dataTable", "infoTable", "image", "bullets"]);

// `nextNode` is the following node in the section, so a lead-in paragraph can
// decide whether to keep with a table/image that follows it.
function buildSectionContent(node, nextNode) {
  const glueToNext = nextNode && GLUE_TO_NEXT_TYPES.has(nextNode.type);
  switch (node.type) {
    case "heading1":
      return [new Paragraph({ heading: HeadingLevel.HEADING_1, children: [headingRun(node.text, { size: 32 })] })];
    case "heading2":
      return [new Paragraph({ heading: HeadingLevel.HEADING_2, children: [headingRun(node.text, { size: 28 })] })];
    case "heading3":
      return [new Paragraph({ heading: HeadingLevel.HEADING_3, children: [headingRun(node.text, { size: 24 })] })];
    // Un-numbered heading that STILL appears in the Table of Contents — used
    // for appendices. The AppendixHeading style carries the outline level and
    // is mapped into the TOC field (buildTOC), so the entry is listed with no
    // section number.
    case "appendixHeading":
      return [new Paragraph({ style: "AppendixHeading", children: [headingRun(node.text, { size: 32 })] })];
    case "paragraph":
      return [new Paragraph({ keepNext: glueToNext, children: [bodyRun(node.text)] })];
    case "bullets":
      return buildBulletList(node.items);
    case "infoTable":
      return [buildInfoTable(node.rows), new Paragraph({ children: [] })];
    case "dataTable":
      return [buildDataTable(node.headers, node.rows, undefined, node.colWeights), new Paragraph({ children: [] })];
    case "image": {
      const fs = require("fs");
      const data = fs.readFileSync(node.path);
      const out = [new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 120, after: 120 },
        children: [new ImageRun({
          data,
          type: node.imgType || "jpg",
          transformation: { width: node.width, height: node.height },
        })],
      })];
      if (node.caption) {
        out.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 160 },
          children: [new TextRun({ text: node.caption, font: FONT_BODY, italics: true, size: 18 })],
        }));
      }
      if (node.pageBreakAfter) out.push(new Paragraph({ children: [], pageBreakBefore: true }));
      return out;
    }
    // Centered, brand-colour, non-numbered heading — used for the report
    // title block ("ATOMAX-UK LTD" / "CABLE CALCULATIONS" / "630A SUPPLY")
    // that must not carry section numbers or appear in the auto TOC.
    case "titleHeading":
      return [new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: node.before ?? 200, after: node.after ?? 100 },
        keepNext: true, keepLines: true,
        children: [headingRun(node.text, { size: node.size || 40, bold: true })],
      })];
    case "subtitle":
      return [new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: node.after ?? 160 },
        keepNext: true, keepLines: true,
        children: [new TextRun({ text: node.text, font: FONT_BODY, italics: node.italics !== false, bold: !!node.bold, size: node.size || 20 })],
      })];
    case "pageBreak":
      return [new Paragraph({ children: [], pageBreakBefore: true })];
    default:
      throw new Error(`Unknown section content node type: ${node.type}`);
  }
}

// ---------------------------------------------------------------------------
// Top-level assembly
// ---------------------------------------------------------------------------

function buildAtomaxDoc(config) {
  const {
    documentTitle, docNumber, revision, date, docRef,
    notice, projectDetails, approval, revisionHistory,
    sections = [], logoPath,
  } = config;

  const children = [
    ...buildCoverBlock({ documentTitle, docRef: docRef || docNumber, date }),
    ...buildNoticeSection(notice),
  ];

  if (projectDetails && projectDetails.length) {
    children.push(new Paragraph({ style: "Heading1NoTOC", children: [headingRun("Project Details", { size: 32 })] }));
    children.push(buildInfoTable(projectDetails));
    children.push(new Paragraph({ children: [] }));
  }

  children.push(new Paragraph({ style: "Heading1NoTOC", children: [headingRun("Document Approval", { size: 32 })] }));
  children.push(buildApprovalTable(approval || []));
  children.push(new Paragraph({ children: [] }));

  children.push(new Paragraph({ style: "Heading1NoTOC", children: [headingRun("Revision History", { size: 32 })] }));
  children.push(buildRevisionHistoryTable(revisionHistory || []));
  children.push(new Paragraph({ children: [] }));

  children.push(...buildTOC());

  for (const section of sections) {
    const content = section.content;
    for (let i = 0; i < content.length; i++) {
      children.push(...buildSectionContent(content[i], content[i + 1]));
    }
  }

  const doc = new Document({
    styles: documentStyles(),
    numbering,
    features: { updateFields: true },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE.width, height: PAGE.height },
            margin: MARGINS,
          },
        },
        headers: { default: buildRunningHeader({ documentTitle, docNumber, revision, date, logoPath }) },
        children,
      },
    ],
  });

  return doc;
}

module.exports = {
  buildAtomaxDoc,
  buildInfoTable,
  buildApprovalTable,
  buildRevisionHistoryTable,
  buildDataTable,
  buildBulletList,
  DEFAULT_NOTICE,
};
