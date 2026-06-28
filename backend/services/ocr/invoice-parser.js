/**
 * Invoice / Credit Note Parser
 * Extracted from document-ocr-service.js for maintainability.
 * Pure function: takes raw OCR text, returns structured invoice/credit note data.
 *
 * Output format matches the LLM-based converter schema:
 *   Invoice  â { purchase_order, invoice_number, seller, buyer, consignee, invoice_details, items[], totals }
 *   Credit   â { Purchseorder, CreditNo, DocumentId, ..., _CREDITI[] }
 */

// âââ Helpers âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

function parseAmount(str) {
  if (!str) return null;
  const num = parseFloat(String(str).replace(/[â¹$â¬Â£,\s]/g, ""));
  return isNaN(num) ? null : num;
}

// Tally-style "Less : Rounded Off (-)0.04" prints the sign inside its own
// parentheses, separate from the digits â and "(1.50)" (accounting notation)
// means a negative value. Neither form is a plain parseFloat-able number.
function parseRoundingAmount(str) {
  if (!str) return null;
  const cleaned = String(str).replace(/[â¹$â¬Â£\s]/g, "");
  const signInParens = cleaned.match(/^\(([-+])\)(.+)$/);
  if (signInParens) {
    const val = parseFloat(signInParens[2].replace(/,/g, ""));
    return isNaN(val) ? null : (signInParens[1] === "-" ? -val : val);
  }
  const wrappedNeg = cleaned.match(/^\(([\d,]*\.?\d+)\)$/);
  if (wrappedNeg) {
    const val = parseFloat(wrappedNeg[1].replace(/,/g, ""));
    return isNaN(val) ? null : -val;
  }
  return parseAmount(cleaned);
}

function fmt(v) {
  // Return string representation or null (credit note fields are all strings)
  if (v === null || v === undefined) return null;
  return String(v);
}

function extractGstins(text) {
  const re = /\b(\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d]{2})\b/g;
  const results = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    let cand = m[1];
    // Position 14 of a GSTIN is always the fixed entity-code letter "Z" â OCR
    // sometimes misreads it as a visually similar digit (e.g. "2"). If forcing
    // it to "Z" makes an otherwise checksum-invalid candidate valid, use the
    // corrected form so the same GSTIN re-OCR'd across multiple passes isn't
    // counted as two different parties' GSTINs.
    if (!gstChecksumValid(cand)) {
      const fixed = fixGstinOcr(cand);
      if (fixed && gstChecksumValid(fixed)) cand = fixed;
    }
    results.push(cand);
  }
  return [...new Set(results)];
}

// GSTIN checksum is a mod-36 check digit over the first 14 characters.
const GST_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GST_FACTORS = [1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2];

function gstChecksumValid(s) {
  if (!s || s.length !== 15) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const cp = GST_CHARS.indexOf(s[i]);
    if (cp < 0) return false;
    const p = cp * GST_FACTORS[i];
    sum += Math.floor(p / 36) + (p % 36);
  }
  return GST_CHARS[(36 - (sum % 36)) % 36] === s[14];
}

// OCR commonly confuses visually-similar letters/digits within a GSTIN. Coerce
// each position to the character class the GSTIN format requires there
// (digits at 1-2/8-11, letters at 3-7/12, fixed "Z" at 14), so a structurally-
// invalid OCR read can still be checksum-validated.
const GST_LETTER_TO_DIGIT = { O: "0", I: "1", S: "5", B: "8", Z: "2", G: "6", T: "7", L: "1", Q: "0", D: "0" };
const GST_DIGIT_TO_LETTER = { "0": "O", "1": "I", "5": "S", "8": "B", "2": "Z", "6": "G", "7": "T", "4": "A" };

function fixGstinOcr(cand) {
  if (!cand || cand.length !== 15) return null;
  let out = "";
  for (let p = 0; p < 15; p++) {
    const c = cand[p];
    if (p < 2 || (p >= 7 && p <= 10)) {
      if (/\d/.test(c)) out += c;
      else if (GST_LETTER_TO_DIGIT[c]) out += GST_LETTER_TO_DIGIT[c];
      else return null;
    } else if ((p >= 2 && p <= 6) || p === 11) {
      if (/[A-Z]/.test(c)) out += c;
      else if (GST_DIGIT_TO_LETTER[c]) out += GST_DIGIT_TO_LETTER[c];
      else return null;
    } else if (p === 13) {
      out += "Z";
    } else {
      out += c;
    }
  }
  return out;
}

// GSTINs are checksum-protected so a single bad character can be detected and
// recovered. If a candidate is otherwise well-formed but fails its checksum,
// and swapping ONLY the checksum digit for its common OCR look-alike (e.g.
// "0"<->"O") makes it valid, accept that correction.
function fixGstinChecksumChar(s) {
  if (!s || s.length !== 15 || gstChecksumValid(s)) return s;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const cp = GST_CHARS.indexOf(s[i]);
    if (cp < 0) return s;
    const p = cp * GST_FACTORS[i];
    sum += Math.floor(p / 36) + (p % 36);
  }
  const expected = GST_CHARS[(36 - (sum % 36)) % 36];
  const ocrPairs = { "0": "O", "O": "0", "1": "I", "I": "1", "5": "S", "S": "5", "8": "B", "B": "8", "2": "Z", "Z": "2", "6": "G", "G": "6", "7": "T", "T": "7" };
  return ocrPairs[s[14]] === expected ? s.slice(0, 14) + expected : s;
}

function extractPAN(text) {
  const m = text.match(/\bPAN\s*(?:No\.?|Number)?\s*[:\-]?\s*([A-Z]{5}\d{4}[A-Z])\b/i);
  return m ? m[1] : null;
}

// PAN is structurally embedded in chars 3-12 of a GSTIN (state code + PAN + entity/Z/checksum).
function panFromGstin(gstin) {
  return gstin && gstin.length === 15 ? gstin.substring(2, 12) : null;
}

// The first 2 digits of a GSTIN are the GST state code (per the official CBIC
// state code list). Used as a fallback when no separate "State Name & Code"
// line is printed for a party (e.g. seller's registered-office state, which
// is often only implied by the seller's own GSTIN).
const GST_STATE_CODES = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab",
  "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana", "07": "Delhi",
  "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim",
  "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram",
  "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
  "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
  "24": "Gujarat", "25": "Daman and Diu", "26": "Dadra and Nagar Haveli",
  "27": "Maharashtra", "28": "Andhra Pradesh (Old)", "29": "Karnataka",
  "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu",
  "34": "Puducherry", "35": "Andaman and Nicobar Islands", "36": "Telangana",
  "37": "Andhra Pradesh", "38": "Ladakh",
};

function stateFromGstin(gstin) {
  if (!gstin || gstin.length < 2) return null;
  return GST_STATE_CODES[gstin.substring(0, 2)] || null;
}

// "Place of Supply" is printed either as "Label: Value" or, in jumbled SAP/Canon
// layouts, as "Value Label" on a single line (e.g. "TAMILNADU, TN-33 Place of Supply").
// Scan line-by-line and try both orderings, skipping lines where the "value" is
// actually another label (e.g. a bare "Place of Supply" line followed by "PAN:...").
function extractPlaceOfSupply(lines) {
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!/place\s*of\s*supply/i.test(t)) continue;
    let m = t.match(/^(.+?)\s+place\s*of\s*supply\s*$/i);
    if (m && m[1].trim().length > 1) return m[1].trim();
    m = t.match(/place\s*of\s*supply\s*[:\-]?\s*(.+)$/i);
    if (m && m[1].trim().length > 1 && !/^(PAN|GSTIN|GST|STATE|CGST|SGST|IGST)\b/i.test(m[1].trim())) {
      let val = m[1].trim();
      // Value sometimes wraps onto the next line, e.g.
      // "Place of Supply: 33-" / "Tamil Nadu"
      if (/-$/.test(val)) {
        const next = (lines[i + 1] || "").trim();
        if (next && /^[A-Za-z]/.test(next) && next.length < 30) {
          val = val + next;
        }
      }
      return val;
    }
  }
  return null;
}

// Address lines often follow the party's name on subsequent lines (e.g.
// "RAR INDUSTRIAL AND LOGISTIC PARK PVT LTD" then "136 USMAN ROAD T NAGAR").
// Collect contiguous address-looking lines after the name, stopping at the
// first line that looks like a different field/label.
function addressAfterName(lines, name) {
  if (!name) return null;
  const idx = lines.findIndex((l) => l.trim().toUpperCase() === name.toUpperCase());
  if (idx < 0) return null;
  const stopPattern = /^(CUSTOMER|GSTIN|STATE\s*NAME|TELEPHONE|PHONE|MOB|EMAIL|CONT\.?\s*PERSON|SHIP\s*TO|BILL\s*TO|TAX\s*INVOICE|ORDER|HSN|ITEM\s*CODE|S\.?\s*NO\.?)/i;
  // Allow embedded commas so multi-place lines like "Kannudaiyanppatti,
  // Manapparai," (village, taluk on one line) are still recognized as a
  // place-name fragment, not just a single bare place name.
  const placeNameRe = /^[A-Za-z][A-Za-z\s,]*,?$/;
  const parts = [];
  for (let i = idx + 1; i < Math.min(idx + 8, lines.length); i++) {
    const t = lines[i].trim();
    if (stopPattern.test(t)) break;
    if (/\d/.test(t) || /\b(ROAD|STREET|PLOT|BLOCK|VILLAGE|NAGAR|FLOOR|SURVEY|DIST|DT|LANE|COLONY|PARK|INDUSTRIAL)\b/i.test(t)) {
      parts.push(t);
      continue;
    }
    // A short, plain place-name line (e.g. "Manapparai", "Trichy") between the
    // street address and the pincode/GSTIN â keep collecting consecutive
    // place-name lines as long as something address-like (another place name,
    // a pincode line, or the GSTIN/State Name label) follows.
    const next = (lines[i + 1] || "").trim();
    if (parts.length && placeNameRe.test(t) && t.length < 40 && (stopPattern.test(next) || /\d/.test(next) || placeNameRe.test(next))) {
      parts.push(t);
      continue;
    }
    break;
  }
  // Parts already end with their own trailing comma (as printed in the
  // source), so joining with ", " leaves a double comma â collapse it.
  return parts.length ? parts.join(", ").replace(/,\s*,/g, ",") : null;
}

// "Ship To Location" (consignee) address sometimes appears as short
// fragments immediately before/after the bare label line, e.g.
// "plot09" / "SHIP TO LOCATION" / "plot no 1 to 14" (jumbled SAP layout).
function addressNearLabel(lines, labelPattern) {
  const isAddressFragment = (t) =>
    t.length > 2 &&
    !/^(CUSTOMER|GSTIN|STATE\s*NAME|TELEPHONE|PHONE|MOB|EMAIL|CONT\.?\s*PERSON|SHIP\s*TO|BILL\s*TO|CO\.?\s*P\.?\/?\s*NO\.?|TAX\s*INVOICE|ORDER|HSN|ITEM\s*CODE|S\.?\s*NO\.?)/i.test(t) &&
    !/^\d{1,5}$/.test(t) &&
    !/^\d{2,4}-\d{2,4}-\d{4,}$/.test(t);

  for (let i = 0; i < lines.length; i++) {
    if (!labelPattern.test(lines[i].trim())) continue;
    const parts = [];
    const before = (lines[i - 1] || "").trim();
    const after = (lines[i + 1] || "").trim();
    if (isAddressFragment(before)) parts.push(before);
    if (isAddressFragment(after)) parts.push(after);
    if (parts.length) return parts.join(", ");
  }
  return null;
}

// Find the nearest standalone 6-digit pincode around a section label
// (e.g. "Ship To Location"), so a party doesn't inherit the wrong
// pincode purely by document-wide ordinal position.
function pincodeNearLabel(lines, labelPattern) {
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!labelPattern.test(t)) continue;
    // Value printed inline with the label, e.g. "Delivery Location: 621306"
    const inline = t.match(/(\d{6})\s*$/);
    if (inline) return inline[1];
    for (let j = Math.max(0, i - 8); j <= Math.min(lines.length - 1, i + 8); j++) {
      if (/^\d{6}$/.test(lines[j].trim())) return lines[j].trim();
    }
  }
  return null;
}

// When the buyer's name wraps onto a second line with its legal-entity suffix
// (e.g. "RAR Industrial and Logistic Park" / "Private Limited Plot No.1 to 14"),
// the lines that follow can interleave TWO addresses â the consignee's
// ship-to address (containing the ship-to pincode) and the buyer's bill-to
// address â in document reading order. Split them at the fragment that
// contains the ship-to pincode.
function splitWrappedAddresses(lines, startIdx, firstFragment, shipToPincode) {
  const isFragment = (t) =>
    t.length > 2 && !/^(GSTIN|STATE|SHIP\s*TO|BILL\s*TO|INDIA|PAN\b)/i.test(t);

  const fragments = [];
  if (firstFragment) fragments.push(firstFragment);
  for (let i = startIdx; i < Math.min(startIdx + 8, lines.length); i++) {
    const t = lines[i].trim();
    if (!isFragment(t)) break;
    // Merge a hyphen-wrapped line continuation into the previous fragment,
    // e.g. "621306 Manapparai-" + "Tiruchirappalli"
    if (fragments.length && /-$/.test(fragments[fragments.length - 1])) {
      fragments[fragments.length - 1] += t;
    } else {
      fragments.push(t);
    }
  }

  const consigneeParts = [];
  const buyerParts = [];
  let seenPincode = false;
  for (const f of fragments) {
    (seenPincode ? buyerParts : consigneeParts).push(f);
    if (f.includes(shipToPincode)) seenPincode = true;
  }
  if (!seenPincode || !buyerParts.length) return null;

  // Drop a fragment if the next fragment repeats it (e.g. "Chennai" then
  // "Chennai, Tamil Nadu-600017").
  const dedupe = (parts) =>
    parts.filter((f, i) => {
      const next = parts[i + 1];
      return !(next && next.toLowerCase().startsWith(f.toLowerCase() + ","));
    });

  return {
    consignee: dedupe(consigneeParts).join(", ").replace(`${shipToPincode} `, "").trim(),
    buyer: dedupe(buyerParts).join(", ").trim(),
  };
}

// Some templates print "Billed To" and "Shipped To" as two side-by-side
// columns; OCR linearizes these into single lines that interleave/duplicate
// text from both columns. The buyer and consignee are the same entity, and
// its name appears twice back-to-back (once per column), e.g.
// "RAR INDUSTRIAL ... PRIVATE RAR INDUSTRIAL ... PRIVATE LIMITED, DATE : ...".
// Detect this layout from the "Billed To : Shipped To :" header and recover
// the (single) party name and address from the duplicated text.
function extractTwoColumnParty(lines) {
  const hdrIdx = lines.findIndex((l) => /Bill(?:ed)?\s*To\s*:\s*Ship(?:p?ed)?\s*To\s*:/i.test(l));
  if (hdrIdx < 0) return null;
  const block = lines.slice(hdrIdx, hdrIdx + 8).join(" ");

  const nameMatch = block.match(/\b([A-Z][A-Z&.,\s]{5,60}?)\s+\1\s*,?\s*(LIMITED|LTD\.?|PVT\.?\s*LTD\.?|PRIVATE\s*LIMITED)\b/);
  const name = nameMatch
    ? `${nameMatch[1].replace(/\s+/g, " ").trim()} ${nameMatch[2]}`.replace(/\s+/g, " ").trim()
    : null;

  const plotMatch = block.match(/PLOT\s*NO\.?[\w\s,.\-]*?(?:SIPCOT[\w\s,.]*?PARK)/i);
  const BLOCKED_CITY_WORDS = new Set(["park", "industrial", "sipcot", "estate", "zone", "complex"]);
  const cityMatch = [...block.matchAll(/\b([A-Z][A-Za-z]{3,})\s*,\s*TAMIL\s*NADU\s*-?\s*(\d{6})\b/gi)]
    .find((m) => !BLOCKED_CITY_WORDS.has(m[1].toLowerCase()));

  const addrParts = [];
  if (plotMatch) {
    addrParts.push(
      plotMatch[0]
        .replace(/[,.\s]+$/, "")
        .replace(/\s*,\s*,\s*/g, ", ")
        .replace(/\s+/g, " ")
        .trim()
    );
  }
  if (cityMatch) addrParts.push(cityMatch[1], `Tamil Nadu - ${cityMatch[2]}`);
  const address = addrParts.length ? addrParts.join(", ") : null;

  if (!name && !address) return null;
  return { name, address };
}

// âââ Party / Address Extraction ââââââââââââââââââââââââââââââââââââââââââââââ

function extractParties(text, lines) {
  const seller = { name: null, gstin: null, pan: null, address: null, state: null, pincode: null };
  const buyer = { name: null, gstin: null, pan: null, address: null, state: null, pincode: null };
  const consignee = { name: null, gstin: null, pan: null, address: null, state: null, pincode: null };

  const gstins = extractGstins(text);

  // --- Seller vs buyer GSTIN ---
  // Primary: position-based â the seller's own GSTIN sits in the letterhead,
  // before any "Bill To"/"Buyer"/"Consignee"/"Recipient"/"Ship To" section
  // label. This holds even in Tally-style templates that print "GSTIN/UIN"
  // for every party (seller included), where the label-based check below
  // can't tell seller from buyer.
  let sellerGstin = null, buyerGstin = null;
  const recipientIdx = text.search(/Recipient\s*Address|Bill(?:ed)?\s*To|Buyer|Ship(?:p?ed)?\s*To|Consignee/i);
  if (recipientIdx > 0) {
    for (const g of gstins) {
      if (text.indexOf(g) < recipientIdx) { sellerGstin = g; break; }
    }
  }
  // Reversed layout: some transport/freight bill templates print the
  // recipient's "Bill To" block FIRST (as its own standalone section-header
  // line), with the issuer's own GSTIN appearing only much later (in the
  // footer/signature block). When every GSTIN comes after that header, the
  // one nearest to it is the recipient's (buyer's) own GSTIN, not the
  // seller's. Anchored to a standalone header line (not just any "Buyer"/
  // "Bill To" substring) so this doesn't misfire on boilerplate T&C text
  // like "...at Buyer's risk."
  const billToHeaderIdx = lines.findIndex((l) =>
    /^(?:Bill(?:ed)?\s*To(?:\s*Ship(?:p?ed)?\s*To)?|Recipient\s*Address|Consignee\s*(?:\(\s*Ship\s*to\s*\))?)\s*[:\-]?\s*$/i.test(l.trim())
  );
  if (!sellerGstin && billToHeaderIdx >= 0 && gstins.length) {
    const billToPos = text.indexOf(lines[billToHeaderIdx]);
    if (gstins.every((g) => text.indexOf(g) > billToPos)) {
      let nearest = null, nearestPos = Infinity;
      for (const g of gstins) {
        const pos = text.indexOf(g);
        if (pos < nearestPos) { nearestPos = pos; nearest = g; }
      }
      if (nearest) buyerGstin = nearest;
    }
  }
  // Secondary: label-based. Per CGST invoice rules / SAP's India localization,
  // "GSTIN/UIN" specifically labels the RECIPIENT's (buyer's) registration,
  // while the issuer's own GSTIN is printed bare ("GSTIN") near the
  // "TAX INVOICE" title. Handles jumbled/value-before-label layouts where
  // every GSTIN happens to appear after the recipient-section label above.
  for (const g of gstins) {
    if (g === sellerGstin) continue;
    const idx = lines.findIndex((l) => l.includes(g));
    if (idx < 0) continue;
    const context = [lines[idx - 1] || "", lines[idx], lines[idx + 1] || ""].join(" ");
    if (/GSTIN\s*\/\s*UIN/i.test(context)) {
      if (!buyerGstin) buyerGstin = g;
    } else if (/\bGSTIN\b/i.test(context) && !sellerGstin) {
      sellerGstin = g;
    }
  }
  if (!sellerGstin && gstins.length >= 1) sellerGstin = gstins.find((g) => g !== buyerGstin) || gstins[0];
  if (!buyerGstin && gstins.length >= 2) buyerGstin = gstins.find((g) => g !== sellerGstin) || gstins[1];
  // Tertiary: fuzzy recovery. The buyer's GSTIN sometimes fails the strict
  // structural regex above because OCR misreads a digit as a letter (or vice
  // versa) within it, e.g. "33AALCRG399H1ZT" instead of "33AALCR6399H1ZT". Scan
  // lines for a 15-char "GSTIN ... <code>" candidate, coerce it to the GSTIN
  // character pattern, and accept it only if its checksum then validates.
  if (!buyerGstin) {
    for (const l of lines) {
      const m = l.match(/GSTIN\s*[:;]?\s*([A-Z0-9]{15})/i);
      if (!m) continue;
      const fixed = fixGstinOcr(m[1].toUpperCase());
      if (fixed && fixed !== sellerGstin && gstChecksumValid(fixed)) {
        buyerGstin = fixed;
        break;
      }
    }
  }
  seller.gstin = sellerGstin;
  buyer.gstin = buyerGstin;
  consignee.gstin = buyerGstin;

  // --- PAN: explicit "PAN:" label, else derived from the GSTIN (chars 3-12) ---
  seller.pan = extractPAN(text) || panFromGstin(sellerGstin);
  buyer.pan = panFromGstin(buyerGstin);
  consignee.pan = buyer.pan;

  // --- Seller name: "Invoicing Party" label, or letterhead line ---
  // Reversed layout (see GSTIN assignment above): the recipient's "Bill To"
  // block sits at the top, so the "first 10 lines" / letterhead heuristics
  // below would otherwise pick up the recipient's name or section labels.
  // The bank account holder's name ("A/C NAME") is a reliable stand-in for
  // the issuing party's name in such transport/freight bill templates.
  if (!seller.name && recipientIdx >= 0 && sellerGstin && text.indexOf(sellerGstin) > recipientIdx) {
    const acNameMatch = text.match(/A\/C\s*NAME\s*[:\-]+\s*([A-Z][A-Za-z\s&.,()]+?)(?:\n|$)/i);
    if (acNameMatch) seller.name = acNameMatch[1].trim().replace(/\s+/g, " ");
  }
  const invPartyMatch = text.match(/Invoicing\s*Party\s*[:\-]?\s*([^\n]+)/i);
  if (invPartyMatch) {
    seller.name = invPartyMatch[1].trim().replace(/^\s*Company\s*/i, "").trim() || null;
  }
  if (!seller.name) {
    // Use "Invoice issued by" or first prominent text
    const issuedBy = text.match(/Invoice\s*issued\s*(?:by|on\s*behalf\s*of)\s*[:\-]?\s*\n?\s*([^\n]+)/i);
    if (issuedBy) seller.name = issuedBy[1].trim();
  }
  if (!seller.name) {
    // Tally "Tax Invoice" header: the seller's letterhead name and the
    // "Invoice No. / Dated" column headers occupy the same printed row, so
    // OCR linearizes them onto a single line, e.g. "AKSHARA AUTOMATION
    // PRIVATE LIMITED Invoice No. Dated". This is more reliable than the
    // "first 10 lines" heuristic below, which can match unrelated header
    // text (logo/address fragments) above this line.
    for (let li = 0; li < Math.min(15, lines.length); li++) {
      const m = lines[li].trim().match(/^([A-Z][A-Z&.,()\-\s]*?(?:PRIVATE\s+LIMITED|PVT\.?\s*LTD\.?|LIMITED|LLP|INC\.?|CORP(?:ORATION)?\.?))\s+(?:Invoice\s*No|GSTIN|State\s*Name|Dated)\b/i);
      if (!m) continue;
      seller.name = m[1].replace(/\s+/g, " ").trim();
      // The seller's street address occupies the 1-2 lines below this
      // header row, with the actual Invoice No./Date values (and other
      // field labels like "Delivery Note") leaking onto the end of each
      // line from the adjacent metadata column.
      const addrParts = [];
      for (let j = li + 1; j < Math.min(li + 3, lines.length); j++) {
        let t = lines[j].trim();
        if (/^GSTIN/i.test(t)) break;
        t = t.replace(/\s+\d{6,10}\s+\d{1,2}[\s.\-](?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s.\-]\d{2,4}\b.*$/i, "");
        t = t.replace(/\s+(Delivery\s*Note(?:\s*Date)?|Dated|Reference\s*No\.?\s*&?\s*Date\.?|Buyer'?s?\s*Order\s*No\.?|Dispatch(?:ed)?\s*(?:Doc\s*No\.?|through)?|Destination|Terms\s*of\s*Delivery)\s*$/i, "");
        if (t) addrParts.push(t);
      }
      if (addrParts.length) seller.address = addrParts.join(", ").replace(/,\s*,/g, ",");
      break;
    }
  }
  if (!seller.name && lines.length > 0) {
    // First non-header line that looks like a company name (check first 10 lines)
    for (const l of lines.slice(0, 10)) {
      let t = l.trim();
      // "For: Company Name" (signature-block letterhead) â use the part after "For:"
      const forPrefix = t.match(/^For\s*[:\-]\s*(.+)$/i);
      if (forPrefix) t = forPrefix[1].trim();
      if (/^(tax\s*invoice|invoice|original|duplicate|credit\s*note|gst\s*invoice|proforma|revised|amended|e[\s-]?invoice|for\s*recipient|copy|auth(?:ori[sz]ed)?\s*signat(?:ory|ure)|this\s+is\s+a\s+computer\s+generated|ack\s*(?:no\.?|date)\b|total\s*in\s*words|(?:indian\s+)?rupees?\b.*\bonly\b)/i.test(t)) continue;
      // Letterhead line: "Company Name Pvt Ltd,<address...>" â split the legal
      // name from the trailing address text instead of rejecting the whole line.
      const suffixMatch = t.match(/^([A-Z][A-Za-z\s&.\-]*?\b(?:Pvt\.?\s*Ltd\.?|Private\s*Limited|Ltd\.?|Limited|LLP|Inc\.?|Corp(?:oration)?\.?))\b[,\s]*(.*)$/);
      if (suffixMatch) {
        // "For <Company> <Suffix>" with nothing else on the line is a
        // signature block ("For Muthra Industries Pvt Ltd" / "Authorized
        // Signature"), not the letterhead heading â letterheads don't start
        // with "For ". Skip it so the GSTIN-anchored fallback below can find
        // the real letterhead name.
        if (/^for\s+/i.test(suffixMatch[1]) && !suffixMatch[2]) continue;
        seller.name = suffixMatch[1].replace(/\s+/g, " ").trim();
        // The remainder after the legal-entity suffix is only an address if
        // it looks like one â reject bare section labels, e.g. "Banking
        // Details:" (this same company name also appears earlier as the
        // heading of the bank-details block, before its real letterhead
        // address). Leave seller.address unset so the GSTIN-anchored
        // fallback below can find the real address.
        if (suffixMatch[2] && suffixMatch[2].trim().length > 5 && !/:\s*$/.test(suffixMatch[2].trim())) {
          seller.address = suffixMatch[2].trim();
        }
        break;
      }
      if (/^[A-Z][A-Za-z\s&.,()\-]+$/.test(t) && t.length > 3) {
        seller.name = t;
        break;
      }
    }
  }
  // Fallback: walk backward from the seller's own GSTIN line. Some letterhead
  // layouts print the company name a few lines above its GSTIN, preceded by a
  // block of summary/footer text (totals, signature, amount-in-words, bank
  // details) that the "first 10 lines" check above doesn't reach. Skip address
  // lines (containing digits) and known non-name labels.
  if (!seller.name && sellerGstin) {
    const gstinIdx = lines.findIndex((l) => l.includes(sellerGstin));
    if (gstinIdx > 0) {
      const skipRe = /^(india|usa|u\.?s\.?a\.?|uk|gstin|pan|tax\s*invoice|invoice|phone|mob(?:ile)?|tel|e-?mail|www\.|notes?|lut|udyam|iec\s*code|bank\s*details|bank\s*a\/c|bank\s*name|ifsc\s*code|state\s*name|cin|msme)\b/i;
      // A company name sometimes wraps onto two lines, with its legal-entity
      // suffix alone on the line directly above (e.g. "Muthra Industries
      // Private" / "Limited"). Prefer this combined form over a single
      // intervening address/state line (e.g. "Tamil Nadu, India") that's
      // closer to the GSTIN.
      const suffixOnlyRe = /^(Pvt\.?\s*Ltd\.?|Private\s*Limited|Ltd\.?|Limited|LLP|Inc\.?|Corp(?:oration)?\.?)\.?$/i;
      for (let j = gstinIdx - 1; j >= Math.max(1, gstinIdx - 6); j--) {
        const t = lines[j].trim();
        if (!suffixOnlyRe.test(t)) continue;
        const prev = lines[j - 1].trim();
        if (/^[A-Z][A-Za-z\s&.,()\-]+$/.test(prev) && prev.length > 3 && !/\d/.test(prev) && !skipRe.test(prev)) {
          seller.name = `${prev} ${t}`.replace(/\s+/g, " ").trim();
          break;
        }
      }
      if (!seller.name) {
        for (let j = gstinIdx - 1; j >= Math.max(0, gstinIdx - 6); j--) {
          const t = lines[j].trim();
          if (!t || /\d/.test(t) || skipRe.test(t)) continue;
          if (/^[A-Z][A-Za-z\s&.,()\-]+$/.test(t) && t.length > 3) {
            seller.name = t;
            break;
          }
        }
      }
    }
  }
  // A boxed/circled logo name is sometimes printed in parentheses or brackets
  // near the top of the letterhead (e.g. "//@ (KRP AGENCY) 7."), which the
  // line-shape heuristics above reject because the surrounding OCR noise
  // doesn't look like a plain company-name line. Multi-pass OCR on a scanned
  // page repeats the letterhead several times with varying garbling, so the
  // bracketed form may only survive near a later occurrence of the seller's
  // own GSTIN rather than in the first 10 lines.
  if (!seller.name) {
    const searchLines = lines.slice(0, 10);
    if (sellerGstin) {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(sellerGstin)) searchLines.push(...lines.slice(i, Math.min(lines.length, i + 6)));
      }
    }
    for (const l of searchLines) {
      const m = l.match(/[(\[]\s*([A-Z][A-Z&.\s]{2,40}?)\s*[)\]]/);
      if (!m) continue;
      const candidate = m[1].replace(/\s+/g, " ").trim();
      if (candidate.length > 3 && /^[A-Z]{4,}$|[A-Z]{2,}.*[A-Z]{2,}/.test(candidate) && !/^(GSTIN|PAN|INVOICE|GST|HSN|SAC|TAX)\b/.test(candidate)) {
        seller.name = candidate;
        break;
      }
    }
  }
  // Tally "for CompanyName" signature line fallback
  if (!seller.name) {
    const forMatch = text.match(/\bfor\s+([A-Z][A-Za-z\s&.,()]+?)(?:\n|$)/i);
    if (forMatch && forMatch[1].length >= 5) {
      let name = forMatch[1].trim();
      // OCR sometimes truncates this signature-line name mid-word, leaving an
      // unbalanced "(" (e.g. "The Precision Scientific Co.(CH"). If so, look
      // for a fuller occurrence of the same name (matching prefix, balanced
      // parens, longer) elsewhere in the document.
      const openParens = (name.match(/\(/g) || []).length;
      const closeParens = (name.match(/\)/g) || []).length;
      if (openParens > closeParens) {
        const prefix = name.slice(0, 15).toLowerCase();
        const fuller = lines.find((l) => {
          const lt = l.trim();
          if (lt.toLowerCase().slice(0, 15) !== prefix) return false;
          const o = (lt.match(/\(/g) || []).length;
          const c = (lt.match(/\)/g) || []).length;
          return o <= c && lt.length > name.length;
        });
        if (fuller) name = fuller.trim();
      }
      seller.name = name;
    }
  }

  // --- Buyer/Consignee name ---
  // If the buyer's name+address wraps across lines (see splitWrappedAddresses
  // below), these capture where the address fragments begin.
  let addrWrapStartIdx = null;
  let addrWrapFirstFragment = null;
  const billTo = text.match(/(?:Bill(?:ed)?\s*To\s*Ship(?:p?ed)?\s*To|Bill(?:ed)?\s*To|Recipient\s*Address|Buyer|Customer\s*Name|Consignee\s*(?:\(Ship\s*to\))?)\s*(?:\([^)]*\))?\s*[:\-]?\s*\n?\s*(?:Company\s*\n?\s*)?([A-Z][A-Za-z\s&.,()]+?)(?:\n|Plot|GSTIN|\d)/i);
  if (billTo && billTo[1].trim().length > 4 && !/^(AND|ADDRESS|NAME|TO|DETAILS?|NO\.?|LOCATION)\b/i.test(billTo[1].trim())) {
    buyer.name = billTo[1].trim();
    // Company name sometimes wraps onto the next line with its legal-entity
    // suffix, e.g. "RAR Industrial and Logistic Park" / "Private Limited Plot No.1 to 14"
    const nameLineIdx = lines.findIndex((l) => l.trim().toUpperCase() === buyer.name.toUpperCase());
    if (nameLineIdx >= 0) {
      const nextLine = (lines[nameLineIdx + 1] || "").trim();
      const suffixMatch = nextLine.match(/^(Pvt\.?\s*Ltd\.?|Private\s*Limited|Ltd\.?|Limited|LLP|Inc\.?|Corp(?:oration)?\.?)\b\s*(.*)$/i);
      if (suffixMatch) {
        buyer.name = `${buyer.name} ${suffixMatch[1]}`.replace(/\s+/g, " ").trim();
        const remainder = (suffixMatch[2] || "").trim();
        if (remainder.length > 2) {
          addrWrapFirstFragment = remainder;
          addrWrapStartIdx = nameLineIdx + 2;
        }
      }
    }
    consignee.name = buyer.name;
  }
  // Tally-style "To." prefix (seller's letterhead followed directly by
  // "To.<Buyer Name>", with the address on the lines that follow), e.g.
  // "To.RAR INDUSTRIAL AND LOGISTICS PARK PRIVATE" / "- LIMITED" /
  // "PIOT NO 1 TO14" / "SIPCOT INDUSTRIAL PARK" / "MANAPPARAI".
  if (!buyer.name) {
    for (let i = 0; i < lines.length; i++) {
      const toMatch = lines[i].match(/^To\b[.,:]?\s*(.+)$/i);
      if (!toMatch) continue;
      let name = toMatch[1].trim();
      if (name.length < 4 || !/^[A-Z]/.test(name)) continue;
      if (seller.name && name.toUpperCase() === seller.name.toUpperCase()) continue;

      let nextIdx = i + 1;
      // The legal-entity suffix sometimes wraps onto the next line as a
      // hyphen-prefixed continuation, e.g. "- LIMITED".
      const cont = (lines[nextIdx] || "").match(/^-\s*([A-Z].+)$/);
      if (cont) {
        name = `${name} ${cont[1].trim()}`.replace(/\s+/g, " ");
        nextIdx++;
      }
      buyer.name = name;
      consignee.name = name;

      // Collect address lines following the name until a label/contact line.
      const stopPattern = /^(GSTIN|STATE\s*NAME|PH\.?\s*[:\-]|PHONE|MOB|EMAIL|TEL|CONT\.?\s*PERSON|PAYMENT\s*TERMS|BILL\s*NO|DATE|PO\s*NO|S\.?\s*NO\.?|DESCRIPTION)/i;
      const addrParts = [];
      for (let j = nextIdx; j < Math.min(nextIdx + 6, lines.length); j++) {
        const t = lines[j].trim();
        if (!t || stopPattern.test(t)) break;
        addrParts.push(t);
      }
      if (addrParts.length) buyer.address = addrParts.join(", ");
      break;
    }
  }
  // "M/S :- <Name>" â common prefix for the buyer/consignee's name in
  // transport/freight bill "Bill To" blocks, with the address on the lines
  // that follow.
  if (!buyer.name) {
    const msIdx = lines.findIndex((l) => /^M\/S\b/i.test(l.trim()));
    if (msIdx >= 0) {
      const msMatch = lines[msIdx].match(/^M\/S\s*[:.\-]*\s*(.+)$/i);
      if (msMatch) {
        const name = msMatch[1].trim().replace(/\s+/g, " ");
        if (name.length > 4 && /^[A-Z]/.test(name)) {
          buyer.name = name;
          consignee.name = name;
          const stopPattern = /^(GST\s*NO|GSTIN|STATE\s*(?:NAME|CODE)|PH\.?\s*[:\-]|PHONE|MOB|EMAIL|TEL|CONT\.?\s*PERSON|PAYMENT\s*TERMS|BILL\s*NO|DATE|PO\s*NO|S\.?\s*NO\.?|DESCRIPTION|LR\.?\s*NO)/i;
          const addrParts = [];
          for (let j = msIdx + 1; j < Math.min(msIdx + 6, lines.length); j++) {
            const t = lines[j].trim().replace(/,\s*$/, "");
            if (!t || stopPattern.test(t)) break;
            addrParts.push(t);
          }
          if (addrParts.length) buyer.address = addrParts.join(", ");
        }
      }
    }
  }
  if (!buyer.name) {
    // Fallback: first all-caps company-like line (excluding the seller's own name)
    for (const l of lines.slice(0, 15)) {
      const t = l.trim();
      if (!/^[A-Z][A-Za-z\s&.,()]+$/.test(t) || t.length <= 3) continue;
      if (/^(tax\s*invoice|invoice|original|duplicate|credit\s*note|gst\s*invoice|proforma|revised|amended|e[\s-]?invoice|for\s*recipient|copy|this\s+is\s+a\s+computer\s+generated|ack\s*(?:no\.?|date)\b)/i.test(t)) continue;
      if (seller.name && t.toUpperCase() === seller.name.toUpperCase()) continue;
      buyer.name = t;
      consignee.name = t;
      break;
    }
  }

  // --- Two-column "Billed To : Shipped To :" layout override ---
  // When this layout is present, the generic single-column heuristics above
  // tend to capture only fragments of the (duplicated) name/address text, or
  // values from the wrong column. The buyer and consignee are the same
  // entity here, so override both with the recovered name/address.
  const twoColParty = extractTwoColumnParty(lines);
  if (twoColParty) {
    if (twoColParty.name) {
      buyer.name = twoColParty.name;
      consignee.name = twoColParty.name;
    }
    if (twoColParty.address) {
      buyer.address = twoColParty.address;
      consignee.address = twoColParty.address;
    }
  }

  // --- Addresses & pincodes ---
  let pincodes = text.match(/\b(\d{6})\b/g) || [];

  // A bank branch code or the bank's own city pincode (e.g. "Branch/Code:
  // Mayapuri/184700" or "City: New Delhi - 110064" inside a "Banking
  // Details ... SWIFT Code" block) is 6 digits too, but it's the bank's, not
  // either party's postal pincode â drop any candidates found in that block.
  const bankBlock = text.match(/Bank(?:ing)?\s*Details[\s\S]*?SWIFT\s*Code[^\n]*/i);
  if (bankBlock) {
    const bankStart = bankBlock.index;
    const bankEnd = bankStart + bankBlock[0].length;
    pincodes = pincodes.filter((p) => {
      const idx = text.indexOf(p);
      return idx < bankStart || idx > bankEnd;
    });
  }

  // A pincode belongs to the seller only if it appears in the seller's own
  // letterhead/address block â i.e. before the buyer/recipient section
  // starts. Otherwise it belongs to the buyer's or consignee's address and
  // must not be misattributed to the seller purely by being first in the doc.
  // Some Tally templates print "Consignee (Ship to)" â with the consignee's
  // own pincode â BEFORE the "Buyer (Bill to)" label, so that section start
  // must also bound the seller's region (a bare "Consignee" mention in T&Cs
  // text doesn't count, hence requiring the "(Ship to)" suffix here).
  const buyerSectionIdx = text.search(/Bill(?:ed)?\s*To|Recipient\s*Address|Buyer|Customer\s*Name|Consignee\s*\(\s*Ship\s*to\s*\)/i);
  const sellerPincode = pincodes.find((p) => {
    const idx = text.indexOf(p);
    return buyerSectionIdx < 0 || idx < buyerSectionIdx;
  });
  if (sellerPincode) seller.pincode = sellerPincode;

  // "Ship To Location" / "Delivery Location" (consignee) often has its own
  // pincode, distinct from the buyer's billing pincode â resolve it from
  // proximity to that label first, so the buyer doesn't inherit the
  // consignee's pincode (or vice versa) purely by document-wide ordinal
  // position.
  const shipToPincode = pincodeNearLabel(lines, /SHIP\s*TO(?:\s*LOCATION)?|DELIVERY\s*LOCATION/i);
  if (shipToPincode) consignee.pincode = shipToPincode;

  const buyerPincode = pincodes.find((p) => p !== seller.pincode && p !== shipToPincode);
  if (buyerPincode) buyer.pincode = buyerPincode;
  if (!consignee.pincode) consignee.pincode = buyer.pincode;

  // If the buyer's name+address wraps across lines and the consignee has its
  // own (different) ship-to pincode, split the interleaved address fragments
  // between the buyer's bill-to address and the consignee's ship-to address.
  let wrappedAddresses = null;
  if (addrWrapFirstFragment && shipToPincode && shipToPincode !== buyerPincode) {
    wrappedAddresses = splitWrappedAddresses(lines, addrWrapStartIdx, addrWrapFirstFragment, shipToPincode);
    if (wrappedAddresses) {
      buyer.address = wrappedAddresses.buyer;
      consignee.address = wrappedAddresses.consignee;
    }
  }

  // --- State from "Place of supply" (buyer's state), with GSTIN-state-code
  // fallback for either party when no "State Name & Code" line is printed
  // for them (common for the seller, whose state is rarely labelled directly). ---
  const placeOfSupply = extractPlaceOfSupply(lines);
  if (placeOfSupply) buyer.state = placeOfSupply.split(",")[0].trim();
  // Strip a leading GST state-code prefix, e.g. "33-Tamil Nadu" -> "Tamil Nadu"
  if (buyer.state) {
    const codeMatch = buyer.state.match(/^\d{1,2}-(.+)$/);
    if (codeMatch) buyer.state = codeMatch[1].trim();
  }
  if (!seller.state) seller.state = stateFromGstin(sellerGstin);
  if (!buyer.state) buyer.state = stateFromGstin(buyerGstin);

  // --- Buyer/consignee address: lines immediately following the buyer's name ---
  if (!buyer.address) {
    const addr = addressAfterName(lines, buyer.name);
    if (addr) buyer.address = addr;
  }

  // --- Seller address: lines between the seller's name and its GSTIN/State
  // Name line, excluding contact-detail lines (phone/email/website). ---
  if (!seller.address && seller.name) {
    let nameIdx = lines.findIndex((l) => l.trim().toUpperCase() === seller.name.toUpperCase());
    if (nameIdx < 0) {
      // Name may be wrapped across two lines (company name + legal-entity
      // suffix on the line below), e.g. "Muthra Industries Private" / "Limited"
      const wrapIdx = lines.findIndex((l, i) =>
        i + 1 < lines.length &&
        `${l.trim()} ${lines[i + 1].trim()}`.replace(/\s+/g, " ").toUpperCase() === seller.name.toUpperCase()
      );
      if (wrapIdx >= 0) nameIdx = wrapIdx + 1;
    }
    const gstinIdx = sellerGstin ? lines.findIndex((l) => l.includes(sellerGstin)) : -1;
    if (nameIdx >= 0 && gstinIdx > nameIdx) {
      const addrLines = lines
        .slice(nameIdx + 1, gstinIdx)
        .map((l) => l.trim().replace(/,\s*$/, ""))
        .filter((l) => l && !/^(phone|mob|mobile|tel|email|e-mail|website|www\.|state\s*name|gstin|pan|msme|cin)\s*[:\-]/i.test(l) && !/^[\d\-+()\s]+$/.test(l) && !/^[A-Za-z\s]+-\s*\d{6}\s*,\s*India\s*$/i.test(l));
      if (addrLines.length) seller.address = addrLines.join(", ");
    } else if (nameIdx >= 0) {
      // Letterhead-style layout: GSTIN/PAN are printed above the company
      // name, with the address on the lines immediately following it
      // (until "TAX INVOICE", the buyer's "To." block, or another label).
      const stopPattern = /^(TAX\s*INVOICE|INVOICE|To[.,:]|GSTIN|STATE\s*NAME|PAN\b|BILL\s*TO|BUYER|CONSIGNEE)/i;
      const addrLines = [];
      for (let i = nameIdx + 1; i < Math.min(nameIdx + 5, lines.length); i++) {
        const t = lines[i].trim().replace(/,\s*$/, "");
        if (!t || stopPattern.test(t) || /^(phone|mob|mobile|tel|email|e-mail|website|www\.|cell)\s*[:\-]?/i.test(t)) break;
        addrLines.push(t);
      }
      if (addrLines.length) seller.address = addrLines.join(", ");
    }
  }

  // Reversed layout: the seller's own address is printed AFTER its GSTIN
  // line (following a "TAX INVOICE" title), not before it.
  if (!seller.address && sellerGstin && recipientIdx >= 0 && text.indexOf(sellerGstin) > recipientIdx) {
    const gIdx = lines.findIndex((l) => l.includes(sellerGstin));
    if (gIdx >= 0) {
      for (let i = gIdx + 1; i < Math.min(gIdx + 4, lines.length); i++) {
        const t = lines[i].trim();
        if (/^(tax\s*invoice|invoice)\b/i.test(t)) continue;
        if (/\d/.test(t) && /[A-Za-z]{2,}/.test(t) && !/^(mob(?:il)?|phone|tel|e-?mail|www\.)/i.test(t)) {
          seller.address = t.replace(/,\s*$/, "");
          break;
        }
      }
    }
  }

  // --- Build remaining addresses from context around GSTIN (fallback only) ---
  for (const party of [{ obj: seller, gstin: sellerGstin }, { obj: buyer, gstin: buyerGstin }]) {
    if (!party.gstin || party.obj.address) continue;

    // A line that actually contains the party's own (already-resolved) pincode
    // is a much stronger address signal than "any line with a digit and 2+
    // letters near the GSTIN" below, which can latch onto unrelated OCR noise
    // (e.g. garbled logo/letterhead text) that happens to sit just before the
    // GSTIN line.
    if (party.obj.pincode) {
      const pinLine = lines.find((l) => l.includes(party.obj.pincode) && /[A-Za-z]{3,}/.test(l));
      if (pinLine) {
        party.obj.address = pinLine.replace(/^[^A-Za-z]+/, "").trim();
        continue;
      }
    }

    const gIdx = text.indexOf(party.gstin);
    if (gIdx < 0) continue;
    // Look backwards for address lines
    const before = text.substring(Math.max(0, gIdx - 300), gIdx);
    const addrLines = before.split("\n").filter(l => l.trim()).slice(-5);
    const addrParts = addrLines.filter(l =>
      /\d/.test(l) && /[A-Za-z]{2,}/.test(l) &&
      !/invoice|date|gstin|pan\b|email|mob|phone|^hsn|sac|^gst|^order/i.test(l)
    );
    if (addrParts.length > 0) {
      party.obj.address = addrParts.join(", ").trim();
    }
  }
  if (!consignee.address) {
    consignee.address = addressNearLabel(lines, /SHIP\s*TO\s*LOCATION/i) || buyer.address;
  }
  if (!consignee.state) consignee.state = buyer.state;

  // A pincode found directly within a party's own resolved address is a far
  // more reliable signal than the whole-document positional heuristics
  // above, which can pick up an unrelated 6-digit code (a bank branch's
  // pincode, a "Dispatch From" location, etc.) purely by ordinal position.
  // Prefer the last 6-digit number in the address (pincodes are printed at
  // the end of Indian addresses).
  for (const party of [seller, buyer, consignee]) {
    if (!party.address) continue;
    const pinMatches = party.address.match(/\b\d{6}\b/g);
    if (pinMatches) {
      party.pincode = pinMatches[pinMatches.length - 1];
    } else {
      // A pincode is sometimes printed with an OCR-inserted space splitting
      // it into two 3-digit groups (e.g. "MADURAI - 625 016" or "Manapparai
      // â 621 306"), so it isn't caught by \b\d{6}\b above.
      const splitPin = party.address.match(/\b(\d{3})\s(\d{3})\b/);
      if (splitPin) party.pincode = splitPin[1] + splitPin[2];
    }
  }

  // Correct a checksum-invalid GSTIN's last character (common 0/O-style OCR
  // confusion) for output only â done last so earlier text-anchored lookups
  // (address/state) still match the GSTIN as it literally appears in the OCR text.
  seller.gstin = fixGstinChecksumChar(seller.gstin);
  buyer.gstin = fixGstinChecksumChar(buyer.gstin);
  consignee.gstin = fixGstinChecksumChar(consignee.gstin);

  return { seller, buyer, consignee };
}

// âââ Invoice Details âââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

function extractInvoiceDetails(text, lines) {
  const details = {
    invoice_date: null,
    delivery_date: null,
    place_of_supply: null,
    supplier_id: null,
    contact_person: null,
  };

  // Invoice date
  const datePatterns = [
    // Tally "Dated\n2-Mar-26" â checked first so the generic numeric pattern
    // below doesn't instead latch onto a "DD-DD/DDDD"-shaped invoice number
    // (e.g. "GICHN/25-26/7311") that happens to appear earlier in the text.
    /\bDated\b[\s.:_\-]*(\d{1,2}[\s.\-](?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s.\-]\d{2,4})/i,
    /(?:date\s*of\s*issue|invoice\s*date|date\s*of\s*invoice|inv\.?\s*date|bill\s*date)[\s.:_\-]*(?:(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)[a-z]*,?\s*)?(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{2,4})/i,
    /(?:invoice\s*date|date\s*of\s*invoice|inv\.?\s*date|bill\s*date|date)[\s.:_\-]*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i,
    /(?:invoice\s*date|date\s*of\s*invoice|inv\.?\s*date|bill\s*date|date)[\s.:_\-]*(\d{1,2}[\s.\-](?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s.\-]\d{2,4})/i,
    /\b(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})\b/,
    /\b(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{2,4})\b/i,
    /(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)[a-z]*,?\s*(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{2,4})/i,
    /(\d{1,2}[\-](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[\-]\d{2,4})/i,
  ];
  for (const pat of datePatterns) {
    const m = text.match(pat);
    if (m) { details.invoice_date = m[1].trim(); break; }
  }

  // Delivery date
  const deliveryDateMatch = text.match(/(?:delivery\s*date|ship\s*date|dispatch\s*date)[\s.:_\-]*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{1,2}[\s.\-](?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s.\-]\d{2,4})/i);
  if (deliveryDateMatch) details.delivery_date = deliveryDateMatch[1].trim();

  // Place of supply
  const posMatch = extractPlaceOfSupply(lines);
  if (posMatch) details.place_of_supply = posMatch;

  // Supplier ID â different ERPs label the same concept "Supplier ID",
  // "Vendor Code/ID/No" or "Supplier Code/No" (SAP vendor master code, etc.)
  const sidMatch = text.match(/(?:Supplier|Vendor)\s*(?:ID|Code|No\.?|Number)\s*[:\-]?\s*(\d+)/i);
  if (sidMatch) details.supplier_id = sidMatch[1];

  // Contact person: "Contact Person" label, or SAP's "CONT.PERSON/NO." label
  // (often printed value-before-label, e.g. "096-298-23946 CONT.PERSON/NO.")
  let cpMatch = text.match(/Contact\s*Person\s*[:\-]?\s*([^\n]+)/i);
  if (!cpMatch) {
    for (let i = 0; i < lines.length; i++) {
      if (!/CONT\.?\s*PERSON\s*\/?\s*NO\.?/i.test(lines[i])) continue;
      const sameLine = lines[i].match(/^(.*?)\s*CONT\.?\s*PERSON/i);
      if (sameLine && sameLine[1].trim()) { cpMatch = [null, sameLine[1].trim()]; break; }
      if (i > 0 && lines[i - 1].trim()) { cpMatch = [null, lines[i - 1].trim()]; break; }
    }
  }
  if (cpMatch) details.contact_person = cpMatch[1].trim();

  return details;
}

// âââ Invoice Number & PO âââââââââââââââââââââââââââââââââââââââââââââââââââââ

function extractInvoiceNumber(text, lines) {
  // "Bill No   2987 A   Date   ..." â a bill number with a single-letter
  // suffix, printed with generous column spacing. Must run before the
  // generic patterns below, which (matching a garbled OCR pass of the same
  // line without inter-word spaces, e.g. "BILL NO2987 ADATE...") would
  // otherwise capture only the numeric part "2987" and drop the " A".
  const billNoSuffixMatch = text.match(/Bill\s*No\.?\s*[.:_\-]?\s*(\d+)\s+([A-Z])\s{2,}/i);
  if (billNoSuffixMatch) {
    return `${billNoSuffixMatch[1]} ${billNoSuffixMatch[2]}`;
  }

  // Canon/SAP: "GST INVOICE NO." label with value on PREVIOUS line (must run first)
  for (let i = 0; i < lines.length; i++) {
    if (/GST\s*INVOICE\s*(?:NO|NUMBER)\.?\s*$/i.test(lines[i].trim())) {
      for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
        const candidate = lines[j].trim();
        // Skip dates, labels, and other non-invoice-number values
        if (/^\d{1,2}[\-\/][A-Z]{3}[\-\/]\d{2,4}$/i.test(candidate)) continue;
        if (/^(GSTIN?|GST\s*INVOICE|TAX\s*INVOICE|STATE|DATE|CGST|SGST)/i.test(candidate)) continue;
        if (/^[A-Z0-9][A-Z0-9\-\/]{2,}$/i.test(candidate) && candidate.length >= 5) {
          return candidate;
        }
      }
    }
  }

  // Tally "Tax Invoice" header: "<Seller Name> Invoice No.  Dated" occupies one
  // printed row (col 1: seller name, col 2: "Invoice No." / "Dated" labels);
  // the actual invoice number and date are on the row below, with the
  // seller's street-address text preceding the number on that line, e.g.
  // "57B 1st FLOOR, NEW COLONY, 2nd MAIN ROAD, 20262707 28-May-26".
  for (let i = 0; i < lines.length - 1; i++) {
    if (!/invoice\s*no\.?/i.test(lines[i])) continue;
    const m = lines[i + 1].match(/\b(\d{6,10})\s+\d{1,2}[\s.\-](?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s.\-]\d{2,4}\b/i);
    if (m) return m[1];
  }

  const invNoPatterns = [
    /invoice\s*(?:no|number|#|num)\.?\s*[.:_\-]?\s*([A-Z0-9][A-Z0-9\-\/]+)/i,
    /inv\s*[.:_\-]\s*(?:no|number|#)?\s*[.:_\-]?\s*([A-Z0-9][A-Z0-9\-\/]+)/i,
    /INV\.?\s*NO\.?\s*[.:_\-]?\s*([A-Z0-9][A-Z0-9\-\/]+)/i,
    /(?<!e[\s-]?way\s*)bill\s*(?:no|number|#)\s*[.:_\-]?\s*([A-Z0-9][A-Z0-9\-\/]+)/i,
    /\b(?:voucher|ref)\s*[.:_\-]?\s*(?:no|number|#)\s*[.:_\-]?\s*([A-Z0-9][A-Z0-9\-\/]+)/i,
    /invoice\s*number\s*[.:_\-]?\s*([A-Z0-9][A-Z0-9\-\/]+)/i,
  ];
  for (const pat of invNoPatterns) {
    const m = text.match(pat);
    if (m) {
      let val = m[1].trim();
      if (/^(date|issue|of|sun|mon|tue|wed|thu|fri|sat|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|erence|the|for|by|and|from|to|e[\s-]?way|cgst|sgst|igst|gst|cess|tds|tcs|customer|carrier|transaction|acknowledgement|order|state|place|type)$/i.test(val)) continue;
      if (val.length < 3) continue;
      // If value ends with - or /, the number may be split across lines â look for continuation
      if (/[-\/]$/.test(val) && lines) {
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(val)) {
            const next = (lines[i + 1] || "").trim();
            if (/^[A-Z0-9][A-Z0-9\-\/]*$/i.test(next) && !/^(date|place|state)/i.test(next)) {
              val = val + next;
            }
            break;
          }
        }
      }
      return val;
    }
  }

  // "Doc No.: Tax Invoice - IVC0366" or "Tax Invoice - IVC0366"
  for (let i = 0; i < lines.length; i++) {
    const dm = lines[i].match(/Tax\s*Invoice\s*[-ââ]\s*([A-Z0-9][A-Z0-9\-\/]{2,})/i);
    if (dm) return dm[1].trim();
  }

  // Tally "Invoice No.   e-Way Bill No." + values on next line
  // Format: "Invoice No.   e-Way Bill No." then "IVC0366   581999006773"
  // (the label's own spacing varies â e.g. "Invoice No.e-Way Bill No." with
  // no space at all between "No." and "e-Way" in some OCR reads).
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/invoice\s*no\.?\s*e[\s-]?way\s*bill\s*no/i);
    if (!m) continue;
    const next = (lines[i + 1] || "").trim();
    // First token before whitespace is the invoice number
    const tokens = next.split(/\s{2,}/);
    if (tokens.length >= 1 && /^[A-Z0-9][A-Z0-9\-\/]{2,}$/i.test(tokens[0].trim())) {
      return tokens[0].trim();
    }
  }

  // Label-on-one-line, value-on-next-line
  for (let i = 0; i < lines.length; i++) {
    if (/invoice\s*(?:no|number)\.?\s*[.:_\-]?\s*$/i.test(lines[i])) {
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        const candidate = lines[j].trim();
        if (/^\d{10,}$/.test(candidate)) continue;
        if (/^[A-Z]{2,}\d{10,}$/i.test(candidate)) continue;
        if (/^[A-Z0-9][A-Z0-9\-\/]{2,}$/i.test(candidate) && !/^(date|place|booking|customer|state|email|e[\s-]?way)/i.test(candidate)) {
          return candidate;
        }
      }
    }
  }

  return null;
}

function extractPurchaseOrder(text, lines) {
  const poPatterns = [
    /Purchase\s*Order\s*[.:_\-]?\s*(\d{6,})/i,
    /PO\s*(?:No|Number|#)\.?[\s.:_\-]*(\d{6,})/i,
    /(?:CUSTOMER\s*)?PO\s*REF\.?\s*(?:No\.?)?\s*[.:_\-]?\s*(\d{6,})/i,
    /ORDER\s*(?:NUMBER|NO|NUM)\.?\s*[.:_\-]?\s*(\d{6,})/i,
    /P\.?\s*O\.?\s*(?:No|Number|#)?\.?\s*[.:_\-]?\s*(\d{6,})/i,
  ];
  for (const pat of poPatterns) {
    const m = text.match(pat);
    if (m) return m[1];
  }

  // Label-on-one-line, value-on-next-line fallback
  if (lines) {
    for (let i = 0; i < lines.length; i++) {
      if (/(?:Purchase\s*Order|PO\s*(?:No|Number|REF|#)|ORDER\s*(?:NUMBER|NO))\.?\s*[.:_\-]?\s*$/i.test(lines[i])) {
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const candidate = lines[j].trim();
          if (/^\d{6,}$/.test(candidate)) return candidate;
        }
      }
    }
  }

  // "ORDER NUMBER" and "CUSTOMER PO REF. No." sometimes appear as bare labels
  // whose values were printed earlier as a shared standalone value-cluster,
  // e.g. [BLUE DART, 351902061, 0, 9410000053] above
  // [CARRIER'S NAME, GCN/WAYBILL NUMBER, CUSTOMER PO REF. No.] (jumbled
  // SAP/Canon table layout). Within that cluster's numeric values, the FIRST
  // belongs to ORDER NUMBER and the LAST to CUSTOMER PO REF. No. "Purchase
  // Order" maps to ORDER NUMBER when present, falling back to CUSTOMER PO REF. No.
  if (lines) {
    const { orderNumber, poRef } = extractOrderNumberAndPoRefFromCluster(lines);
    if (orderNumber) return orderNumber;
    if (poRef) return poRef;
  }

  // "Buyer's Order No." (Tally-style invoices) sometimes holds free text
  // (e.g. a phone-order reference with the customer's contact name) instead
  // of a numeric PO number â accept the line right after the label as long
  // as it isn't itself another field label (i.e. the field was left blank).
  if (lines) {
    const boIdx = lines.findIndex((l) => /^Buyer['ââ]?s\s*Order\s*No\.?\s*$/i.test(l.trim()));
    if (boIdx >= 0) {
      const candidate = (lines[boIdx + 1] || "").trim();
      if (candidate && !/^(Dated|Dispatch|Delivery|Destination|Terms|Mode|Other\s*References|Reference)\b/i.test(candidate)) {
        return candidate;
      }
    }
  }

  // "Buyer Order (PO) No: <value>" on a single line â the value may be
  // non-numeric free text (e.g. "Mail Confirmation", "Phone Order") rather
  // than a PO number.
  const inlineBuyerOrder = text.match(/Buyer['ââ]?s?\s*Order\s*(?:\(PO\))?\s*No[ \t.]*[:\-][ \t]*([^\n]+)/i);
  if (inlineBuyerOrder) {
    const candidate = inlineBuyerOrder[1].trim();
    if (candidate && !/^(Dated|Dispatch|Delivery|Destination|Terms|Mode|Other\s*References|Reference)\b/i.test(candidate)) {
      return candidate;
    }
  }

  return null;
}

function extractOrderNumberAndPoRefFromCluster(lines) {
  const labelSkipPattern = /^(CARRIER'?S?\s*NAME|GCN\s*\/?\s*WAYBILL\s*NUMBER|TRANSPOTER\s*MODE|ORDER\s*TYPE)\b/i;
  const hasOrderNumberLabel = lines.some((l) => /^ORDER\s*NUMBER\.?\s*$/i.test(l.trim()));

  for (let i = 0; i < lines.length; i++) {
    if (!/(?:CUSTOMER\s*)?PO\s*REF\.?\s*(?:No\.?)?\s*[.:_\-]?\s*$/i.test(lines[i].trim())) continue;

    let j = i - 1;
    while (j >= 0 && labelSkipPattern.test(lines[j].trim())) j--;

    const cluster = [];
    while (j >= 0) {
      const t = lines[j].trim();
      if (!t || t.split(/\s+/).length > 3 || /[.:]/.test(t)) break;
      cluster.unshift(t);
      j--;
      if (cluster.length >= 6) break;
    }

    const numeric = cluster.filter((c) => /^\d+$/.test(c));
    if (!numeric.length) continue;

    const poRef = numeric[numeric.length - 1];
    const orderNumber = hasOrderNumberLabel && numeric.length >= 2 ? numeric[0] : null;
    return { orderNumber, poRef };
  }

  return { orderNumber: null, poRef: null };
}

// âââ Currency Detection ââââââââââââââââââââââââââââââââââââââââââââââââââââââ

function detectCurrency(text) {
  // Indian GST invoices are INR even when a stray currency glyph (e.g. a lone
  // OCR-misread "Â£") leaks in. A GSTIN anywhere on the page is a definitive
  // India marker, so resolve to INR before considering symbol-only matches.
  if (/INR|â¹|Rs\.?/i.test(text) || extractGstins(text).length > 0) return "INR";
  // For foreign currencies, require the symbol/code to sit next to an amount â
  // an isolated symbol from OCR noise must not override the default.
  if (/USD|\$\s*\d/.test(text)) return "USD";
  if (/EUR|â¬\s*\d/.test(text)) return "EUR";
  if (/GBP|Â£\s*\d/.test(text)) return "GBP";
  return "INR";
}

// âââ Canon / SAP multi-column "TAX INVOICE" layout âââââââââââââââââââââââââââ
// This template prints each table column as a separate VERTICAL block in the
// text layer (all item codes stacked, then all descriptions, then HSN codes,
// then the Taxable/CGST/SGST amounts), so the line-oriented strategies below
// can never reconstruct a row. Instead we anchor on the labelled blocks and zip
// them together by item index.

// Split a list of contiguous lines into n roughly-equal, in-order groups.
function splitEven(arr, n) {
  if (n <= 0) return [];
  const groups = Array.from({ length: n }, () => []);
  const base = Math.floor(arr.length / n);
  let rem = arr.length % n;
  let idx = 0;
  for (let g = 0; g < n; g++) {
    const take = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem--;
    for (let k = 0; k < take && idx < arr.length; k++) groups[g].push(arr[idx++]);
  }
  return groups.map((g) => g.join(" ").replace(/\s+/g, " ").trim());
}

function extractCanonSapItems(lines, currency) {
  // 1) HSN codes: the run of 8-digit lines immediately before the HSN/SAC label.
  const hsnIdx = lines.findIndex((l) => /^HSN\s*\/?\s*SAC$/i.test(l.trim()));
  if (hsnIdx < 1) return [];
  const hsnCodes = [];
  for (let i = hsnIdx - 1; i >= 0; i--) {
    if (/^\d{8}$/.test(lines[i].trim())) hsnCodes.unshift(lines[i].trim());
    else break;
  }
  const N = hsnCodes.length;
  if (N < 1) return [];

  // 2) Item codes: first run of >= N alnum-with-dash codes that contain a letter.
  //    The letter requirement excludes phone numbers (880-780-1007); the dash
  //    requirement excludes "Consist Of" component codes (3813C001AA).
  const isCode = (l) => /^(?=[A-Z0-9-]*[A-Z])[A-Z0-9]+-[A-Z0-9-]+$/.test(l.trim());
  let codes = [];
  let codesEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!isCode(lines[i])) continue;
    let j = i;
    const run = [];
    while (j < lines.length && isCode(lines[j])) run.push(lines[j++].trim());
    if (run.length >= N) { codes = run.slice(0, N); codesEnd = i + N; break; }
    i = j;
  }

  // 3) Descriptions: alpha lines after the item-code run, up to the first numeric
  //    or "Consist Of" line; split into N contiguous groups.
  const descLines = [];
  if (codesEnd >= 0) {
    for (let i = codesEnd; i < lines.length; i++) {
      const t = lines[i].trim();
      if (/^consist\s*of$/i.test(t)) break;
      if (/^[\d,.%]+$/.test(t) || /^[\d,]+\s+[\d,]+/.test(t)) break;
      if (/[A-Za-z]{2,}/.test(t)) descLines.push(t);
      else break;
    }
  }
  const descGroups = splitEven(descLines, N);

  // 4) Taxable values per item: find amounts from multiple sources.
  let taxable = null;

  // 4a) Try "Taxable" + "Value" label, then N contiguous numbers immediately after.
  //     Only accept numbers in a tight window (max 3 non-numeric lines gap).
  //     Skip small non-zero numbers (< 100, e.g. state code "33") before amounts.
  //     Reject huge numbers (> 1e12) â these are Acknowledgement/IRN numbers.
  for (let i = 1; i < lines.length && !taxable; i++) {
    if (!/^value$/i.test(lines[i].trim()) || !/^taxable$/i.test(lines[i - 1].trim())) continue;
    const out = [];
    let gap = 0;
    for (let j = i + 1; j < lines.length && out.length < N && gap < 4; j++) {
      const t = lines[j].trim().replace(/,/g, "");
      if (!/^\d+(?:\.\d+)?$/.test(t)) { gap++; continue; }
      const v = parseFloat(t);
      if (v > 1e12) { gap++; continue; }  // skip Ack numbers / IRN
      if (out.length === 0 && v < 100 && v !== 0) { gap++; continue; }  // skip state codes before amounts
      out.push(v);
      gap = 0;
    }
    if (out.length === N) taxable = out;
    if (out.length === 1 && N > 1) { taxable = out; break; }
  }

  // 4b) Try "TAXABLE VALUE" on single line followed by amount
  if (!taxable) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].trim().match(/TAXABLE\s*VALUE\s+([\d,]+(?:\.\d{1,2})?)/i);
      if (m) { taxable = [parseFloat(m[1].replace(/,/g, ""))]; break; }
    }
  }

  // 4c) Try "Sub Total:" line with amounts
  if (!taxable) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].trim().match(/Sub\s*Total\s*[:\s]+([\d,]+(?:\.\d{1,2})?)/i);
      if (m) { taxable = [parseFloat(m[1].replace(/,/g, ""))]; break; }
    }
  }

  if (!taxable) return [];

  // 5) GST rate: the dominant non-zero percentage on the page (e.g. 9%). CGST and
  //    SGST are each rate% of the taxable value â derived rather than parsed from
  //    the scattered amount blocks, which are indistinguishable from the discount
  //    and S.No columns.
  const pcts = lines
    .map((l) => l.trim())
    .filter((l) => /^\d+(?:\.\d+)?%$/.test(l))
    .map((l) => parseFloat(l))
    .filter((p) => p > 0);
  const counts = {};
  for (const p of pcts) counts[p] = (counts[p] || 0) + 1;
  const rate = pcts.length
    ? parseFloat(Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0])
    : 0;

  const items = [];

  // Single taxable value for multiple HSN codes â emit each item separately,
  // assigning the full value to the item most likely to be the priced one.
  // Bundled accessories (furniture ch.94, instruments ch.90) are typically
  // supplied at nil value alongside the main equipment (machinery/electrical
  // ch.84/85), so prefer that item when exactly one HSN matches.
  if (taxable.length === 1 && N > 1) {
    const net = taxable[0];
    const tax = Math.round(net * (rate / 100) * 2 * 100) / 100;
    const machineryIdxs = hsnCodes.reduce((acc, h, idx) => (/^8[45]/.test(h || "") ? acc.concat(idx) : acc), []);
    const valueIdx = machineryIdxs.length === 1 ? machineryIdxs[0] : 0;
    for (let i = 0; i < N; i++) {
      const desc = descGroups[i] || codes[i] || `Item ${i + 1}`;
      const isPriced = i === valueIdx;
      items.push({
        item_no: i + 1,
        description: codes[i] ? `${codes[i]} ${desc}`.trim() : desc,
        hsn_code: hsnCodes[i] || null,
        quantity: 1,
        unit: null,
        unit_price: isPriced ? net : 0,
        net_value: isPriced ? net : 0,
        tax_amount: isPriced ? tax : 0,
        currency,
      });
    }
    return items;
  }

  for (let i = 0; i < N; i++) {
    const net = taxable[i] || 0;
    const tax = Math.round(net * (rate / 100) * 2 * 100) / 100; // CGST + SGST
    const desc = descGroups[i] || codes[i] || `Item ${i + 1}`;
    items.push({
      item_no: i + 1,
      description: codes[i] ? `${codes[i]} ${desc}`.trim() : desc,
      hsn_code: hsnCodes[i] || null,
      quantity: 1,
      unit: null,
      unit_price: net,
      net_value: net,
      tax_amount: tax,
      currency,
    });
  }
  return items;
}

// âââ e-Way Bill "Goods Details" section parser ââââââââââââââââââââââââââââââ
// Every e-Invoice PDF contains an e-Way Bill section with structured goods data
// in the format:  HSN  description  qty  NOS/unit  amount  taxRate(C+S)
// This section is the cleanest, most reliable data source for line items.
function extractEwayGoodsItems(lines, currency) {
  // Find ALL "Goods Details" sections and parse each, keep the best result
  const sections = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\d*\.?\s*Goods\s*Details/i.test(lines[i].trim())) {
      sections.push(i);
    }
  }
  if (sections.length === 0) return [];

  let bestItems = [];
  for (const goodsStart of sections) {
    const sectionItems = _parseEwayGoodsSection(lines, goodsStart, currency);
    if (sectionItems.length > bestItems.length) bestItems = sectionItems;
  }
  return bestItems;
}

function _parseEwayGoodsSection(lines, goodsStart, currency) {
  const items = [];

  // Find the section end (Transportation Details, Vehicle Details, or end of text)
  let goodsEnd = lines.length;
  for (let i = goodsStart + 1; i < lines.length; i++) {
    if (/^\d*\.?\s*(Transportation|Vehicle)\s*Details/i.test(lines[i].trim())) {
      goodsEnd = i;
      break;
    }
    if (/^Tot\.?\s*Taxable\s*Amt/i.test(lines[i].trim())) {
      goodsEnd = i;
      break;
    }
    // Stop if we hit another Goods Details section
    if (i > goodsStart && /^\d*\.?\s*Goods\s*Details/i.test(lines[i].trim())) {
      goodsEnd = i;
      break;
    }
  }

  // Skip header lines (HSN, Code, Product Name & Desc, etc.)
  let dataStart = goodsStart + 1;
  for (let i = goodsStart + 1; i < Math.min(goodsStart + 5, goodsEnd); i++) {
    if (/^(HSN|Code|Product|Quantity|Taxable|Tax\s*Rate|\(C\+S\))/i.test(lines[i].trim())) {
      dataStart = i + 1;
    }
  }

  // Parse each goods line: HSN desc qty NOS/unit amount taxRate
  const p = (s) => parseFloat(s.replace(/,/g, ""));
  // Full line: HSN desc qty unit amount [taxRate]
  const hsnDescAmtRe = new RegExp(
    `^(\\d{4,8})\\s+(.+?)\\s+(\\d+)\\s+(${UNIT_LIST})\\s+([\\d,]+(?:\\.\\d{1,2})?)(?:\\s+(\\d+(?:\\.\\d+)?\\+\\d+(?:\\.\\d+)?))?`,
    "i"
  );
  // HSN + desc only (qty/amount on following lines): HSN desc [trailing &/text]
  const hsnDescOnlyRe = /^(\d{4,8})\s+([A-Za-z].{5,})$/;
  // qty + amount line: qty NOS/unit amount [taxRate]
  const qtyAmtRe = new RegExp(
    `^(\\d+)\\s+(${UNIT_LIST})\\s+([\\d,]+(?:\\.\\d{1,2})?)(?:\\s+(\\d+(?:\\.\\d+)?\\+\\d+(?:\\.\\d+)?))?$`,
    "i"
  );

  let i = dataStart;
  while (i < goodsEnd) {
    const line = lines[i].trim();
    i++;

    // Try full-line match first
    let hsn, desc, qty, unit, amount, taxRateStr;
    const m = line.match(hsnDescAmtRe);
    if (m) {
      hsn = m[1]; desc = m[2].trim(); qty = parseInt(m[3]); unit = m[4].toLowerCase();
      amount = p(m[5]); taxRateStr = m[6] || "";
    } else {
      // Try HSN + desc only (qty/amount on following lines)
      const m2 = line.match(hsnDescOnlyRe);
      if (!m2) continue;
      hsn = m2[1]; desc = m2[2].trim();
      qty = 0; unit = null; amount = 0; taxRateStr = "";

      // Collect continuation desc lines and find qty/amount line
      while (i < goodsEnd) {
        const nextLine = lines[i].trim();
        if (/^\d{4,8}\s+/.test(nextLine)) break;
        if (/^(Tot\.?\s*Taxable|Page\s*\d|e[\s-]?Way\s*Bill|\d+\.\s*(Transportation|Vehicle))/i.test(nextLine)) break;

        // Check if this is a qty+amount line
        const qm = nextLine.match(qtyAmtRe);
        if (qm) {
          qty = parseInt(qm[1]); unit = qm[2].toLowerCase(); amount = p(qm[3]);
          taxRateStr = qm[4] || "";
          i++;
          break;
        }
        // Append description text
        if (/[A-Za-z]{2,}/.test(nextLine) && !/^[\d,.+%\s]+$/.test(nextLine)) {
          desc += " " + nextLine;
        }
        i++;
      }
      if (qty <= 0 || amount <= 0) continue;
    }

    // Continuation lines for description (until next HSN line or section end)
    while (i < goodsEnd) {
      const nextLine = lines[i].trim();
      if (/^\d{4,8}\s+/.test(nextLine)) break;
      if (/^(Tot\.?\s*Taxable|Page\s*\d|e[\s-]?Way\s*Bill|\d+\.\s*(Transportation|Vehicle))/i.test(nextLine)) break;
      if (/^[\d,.+%\s]+$/.test(nextLine)) break;
      if (new RegExp(`^\\d+\\s+(${UNIT_LIST})\\s+`, "i").test(nextLine)) break;
      if (/[A-Za-z]{2,}/.test(nextLine)) {
        desc += " " + nextLine;
      }
      i++;
    }

    // Calculate tax from rate string like "9+9" or "2.50+2.50"
    let taxAmount = null;
    if (taxRateStr) {
      const rates = taxRateStr.split("+").map(r => parseFloat(r));
      const totalRate = rates.reduce((s, r) => s + r, 0);
      if (totalRate > 0) {
        taxAmount = Math.round(amount * (totalRate / 100) * 100) / 100;
      }
    }

    // Clean up description
    desc = desc.replace(/\s*e\s*-?\s*Way\s*Bill.*$/i, "").trim();  // Remove e-Way Bill text
    desc = desc.replace(/\s*&\s*(?:Instruments?|INSTRUMENTS?)?\s*$/i, "").trim();
    desc = desc.replace(/\s*&\s*$/, "").trim();
    desc = desc.replace(/\s{2,}/g, " ").trim();  // Collapse extra spaces from OCR

    if (desc && amount > 0 && qty > 0) {
      items.push({
        item_no: null,
        description: desc,
        hsn_code: hsn,
        quantity: qty,
        unit,
        unit_price: Math.round((amount / qty) * 100) / 100,
        net_value: amount,
        tax_amount: taxAmount,
        currency,
      });
    }
  }

  return items;
}

// âââ Line Normalization âââââââââââââââââââââââââââââââââââââââââââââââââââââ

const UNIT_LIST = "kg|l|nos|pcs|mt|ton|unit|gm|g|ltr|lit|each|set|pair|box|bag|pkt|kgs|ltrs|units|sets|pairs|boxes|bags|mts|tons|qty|bundle|bundles|roll|rolls|drum|drums|can|cans|bottle|bottles|jar|jars|piece|pieces|meter|meters|mtr|mtrs|ft|feet|cm|mm|sqft|sqm|rft|cft|cbm|ream|reams|doz|dozen|no";

function normalizeLine(line) {
  return line
    .replace(/[â¹$â¬Â£Â¥]/g, "")
    .replace(/\|/g, " ")
    .replace(/\(\d+(?:\.\d+)?%\)/g, "")
    .replace(new RegExp(`\\bPer\\s+(?:${UNIT_LIST})\\b`, "gi"), "")
    .replace(/\bDisc\.?\s*%?\s*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isHeaderOrMeta(line) {
  if (/^(s\.?\s*no|sl|#|item\s*desc|description|particular|qty|rate|amount|hsn|sac|gst|tax\s|total|sub\s*total|net\s*amount|gross|invoice|bill\s|igst|cgst|sgst)\b/i.test(line)) return true;
  if (/^(date|to\b|from\b|address|phone|email|gstin|pan\b|place|state|bank|a\/c|ifsc|payment|transaction|note\b|value\s*of)/i.test(line)) return true;
  if (/\b(net\s*amount|tax\s*amount|grand\s*total)\b/i.test(line)) return true;
  if (isContactLine(line)) return true;
  return false;
}

// Header/footer contact lines (e.g. "Credit Bill Cell : 89032 49690") carry a
// phone/fax number that the digit-oriented strategies otherwise mis-read as a
// qty/price/amount row. A contact keyword adjacent to a number is never a line
// item, so reject the whole line before extraction.
function isContactLine(line) {
  return /\b(cell|mobile|mob|phone|ph|tel|telephone|contact|fax|whats\s*app|call)\b\s*[:.\-]?\s*\+?\d/i.test(line);
}

// âââ Line Item Extraction ââââââââââââââââââââââââââââââââââââââââââââââââââââ

// Phase 1a: â¹-concatenated amount lines (e.g. BookMyShow)
function extractCurrencyConcatItems(text, currency) {
  const parseAmt = (s) => { if (!s) return null; const n = parseFloat(String(s).replace(/[â¹$â¬Â£,\s]/g, "")); return isNaN(n) ? null : n; };
  const regex = /(\d{4,8})â¹([\d,]+\.\d{1,2})(\d+)â¹([\d,.]+)â¹([\d,.]+)/g;
  const items = [];
  let m;
  while ((m = regex.exec(text)) !== null) {
    const hsnCode = m[1];
    const unitPrice = parseAmt(m[2]);
    const qty = parseInt(m[3]);
    const netAmt = parseAmt(m[4]);
    const taxAmt = parseAmt(m[5]);
    if (!unitPrice || !qty || qty < 1 || qty > 100000) continue;

    const before = text.substring(Math.max(0, m.index - 500), m.index);
    const descLines = before.split("\n").reverse();
    let desc = "";
    for (const dl of descLines) {
      const trimmed = dl.replace(/^\d+/, "").trim();
      if (!trimmed) continue;
      if (/^(item\s*desc|hsn|sac|price|quantity|amount|tax|total|net|unit)/i.test(trimmed)) break;
      if (/[A-Za-z]{2,}/.test(trimmed)) {
        desc = trimmed + (desc ? " " + desc : "");
        if (/^\d+[A-Z]/.test(dl.trim())) break;
      } else break;
    }
    if (desc && desc.length >= 3) {
      items.push({ item_no: null, description: desc.replace(/[-ââ,]\s*$/, "").trim(), hsn_code: hsnCode, quantity: qty, unit: null, unit_price: unitPrice, net_value: netAmt, tax_amount: taxAmt, currency });
    }
  }
  return items;
}

// Phase 2: Unified same-line extraction (consolidates Strategies 0b, 0a, 0, 1)
function extractSameLineItems(lines, currency) {
  const items = [];

  // Regexes ordered by specificity (most fields first)
  // Tally ERP: item# desc net_value unit unit_price qty unit gst% hsn
  const tallyRe = /^(\d+)\s+(.+?)\s+([\d,]+\.\d{2})\s+(NO|NOS|PCS|KG|KGS|LTR|SET|EACH|UNIT|BOX|BAG|MT|TON|GM|L|PKT|PAIR|BAGS|PAIRS|LTRS|UNITS|SETS|BOXES)\s+([\d,]+\.\d{2})\s+(\d+)\s+(?:NO|NOS|PCS|KG|KGS|LTR|SET|EACH|UNIT|BOX|BAG|MT|TON|GM|L|PKT|PAIR|BAGS|PAIRS|LTRS|UNITS|SETS|BOXES)\s+(\d+)\s*%\s+(\d{4,8})$/i;
  // Tally concatenated: desc+net_value+unit+unit_price+qty unit gst% hsn
  const tallyConcatRe = /^([A-Z][A-Za-z&\s.,\-\/()]+?)([\d,]+\.\d{2})(NO|NOS|PCS|KG|KGS|LTR|SET|EACH|UNIT|BOX|BAG|MT|TON|GM|L|PKT)([\d,]+\.\d{2})(\d+)\s+(NO|NOS|PCS|KG|KGS|LTR|SET|EACH|UNIT|BOX|BAG|MT|TON|GM|L|PKT)\s*(\d+)\s*%\s*(\d{4,8})$/i;
  const unitRe = new RegExp(`^(\\d+)\\s+(.+?)\\s+(\\d{4,8})\\s+([\\d,]+(?:\\.\\d+)?)\\s*(${UNIT_LIST})\\s+([\\d,]+(?:\\.\\d{1,2})?)\\s+([\\d,]+(?:\\.\\d{1,2})?)\\s+([\\d,]+(?:\\.\\d{1,2})?)$`, "i");
  const sapInvRe = new RegExp(`^(\\d+)\\s+(.+?)\\s+(\\d{4,8})\\s+([\\d,.]+)\\s*(${UNIT_LIST})\\s+[\\d\\-A-Za-z]+\\s+([\\d,.]+)\\s*INR\\s+([\\d,.]+)\\s*INR\\s+([\\d,.]+)\\s*INR`, "i");
  const wideRe = /^(\d+)\s+(.+?)\s+(\d{4,8})\s+([\d,]+(?:\.\d{1,3})?)\s+([\d,]+(?:\.\d{1,3})?)\s+([\d,]+(?:\.\d{1,2})?)\s+([\d,]+(?:\.\d{1,2})?)\s+([\d,]+(?:\.\d{1,2})?)$/;
  // P2b: item# desc HSN qty unit price net tax% total (9-field with unit + tax%)
  const unitTaxPctRe = new RegExp(`^(\\d+)\\s+(.+?)\\s+(\\d{4,8})\\s+([\\d,]+(?:\\.\\d+)?)\\s*(${UNIT_LIST})\\s+([\\d,]+(?:\\.\\d{1,2})?)\\s+([\\d,]+(?:\\.\\d{1,2})?)\\s+(\\d{1,2}(?:\\.\\d+)?)\\s+([\\d,]+(?:\\.\\d{1,2})?)$`, "i");
  // P2c: item# desc HSN qty unit price net (7-field, unit between qty and price, 2 amounts)
  const unitShortRe = new RegExp(`^(\\d+)\\s+(.+?)\\s+(\\d{4,8})\\s+([\\d,]+(?:\\.\\d+)?)\\s*(${UNIT_LIST})\\s+([\\d,]+(?:\\.\\d{1,2})?)\\s+([\\d,]+(?:\\.\\d{1,2})?)$`, "i");
  // P2d: desc HSN qty unit price net (no item#)
  const unitNoItemRe = new RegExp(`^(.+?)\\s+(\\d{4,8})\\s+([\\d,]+(?:\\.\\d+)?)\\s*(${UNIT_LIST})\\s+([\\d,]+(?:\\.\\d{1,2})?)\\s+([\\d,]+(?:\\.\\d{1,2})?)$`, "i");
  // P2e: item# desc HSN qty unit price (6-field, net = qty * price)
  const unitMinRe = new RegExp(`^(\\d+)\\s+(.+?)\\s+(\\d{4,8})\\s+([\\d,]+(?:\\.\\d+)?)\\s*(${UNIT_LIST})\\s+([\\d,]+(?:\\.\\d{1,2})?)$`, "i");
  const hsn6Re = /^(\d+)\s+(.+?)\s+(\d{4,8})\s+([\d,]+(?:\.\d{1,2})?)\s+([\d,]+(?:\.\d{1,2})?)\s+([\d,]+(?:\.\d{1,2})?)$/;
  const fiveRe = /^(\d+)\s+(.+?)\s+([\d,]+(?:\.\d{1,2})?)\s+([\d,]+(?:\.\d{1,2})?)\s+([\d,]+(?:\.\d{1,2})?)$/;
  const fourRe = /^(.+?)\s+([\d,]+(?:\.\d{1,2})?)\s+([\d,]+(?:\.\d{1,2})?)\s+([\d,]+(?:\.\d{1,2})?)$/;

  const p = (s) => parseFloat(s.replace(/,/g, ""));

  for (const line of lines) {
    const cleaned = normalizeLine(line);
    if (isHeaderOrMeta(cleaned)) continue;

    let m;

    // P0: Tally ERP format â [item#] desc net_value unit unit_price qty unit gst% hsn
    m = cleaned.match(tallyRe);
    if (m && /[A-Za-z]{2,}/.test(m[2])) {
      const netValue = p(m[3]); const unitPrice = p(m[5]); const qty = parseInt(m[6]);
      const gstRate = parseInt(m[7]); const hsn = m[8]; const unit = m[4].toLowerCase();
      if (qty >= 1 && qty <= 10000000 && unitPrice > 0) {
        const taxAmount = Math.round(netValue * (gstRate / 100) * 100) / 100;
        items.push({ item_no: parseInt(m[1]) || null, description: m[2].trim(), hsn_code: hsn, quantity: qty, unit, unit_price: unitPrice, net_value: netValue, tax_amount: taxAmount > 0 ? taxAmount : null, currency });
        continue;
      }
    }
    // Tally concatenated (no spaces between fields)
    m = line.match(tallyConcatRe);
    if (!m) m = cleaned.match(tallyConcatRe);
    if (m && /[A-Za-z]{2,}/.test(m[1])) {
      const desc = m[1].trim(); const netValue = p(m[2]); const unitPrice = p(m[4]);
      const qty = parseInt(m[5]); const gstRate = parseInt(m[7]); const hsn = m[8];
      const unit = m[3].toLowerCase();
      if (qty >= 1 && qty <= 10000000 && unitPrice > 0) {
        const taxAmount = Math.round(netValue * (gstRate / 100) * 100) / 100;
        items.push({ item_no: null, description: desc, hsn_code: hsn, quantity: qty, unit, unit_price: unitPrice, net_value: netValue, tax_amount: taxAmount > 0 ? taxAmount : null, currency });
        continue;
      }
    }

    // P1: SAP INR format â item# desc HSN qty unit date price INR net INR tax INR
    m = line.match(sapInvRe);
    if (m) {
      items.push({ item_no: parseInt(m[1]), description: m[2].trim(), hsn_code: m[3], quantity: p(m[4]), unit: m[5].toLowerCase(), unit_price: p(m[6]), net_value: p(m[7]), tax_amount: p(m[8]), currency });
      continue;
    }

    // P2: Unit format â item# desc HSN qty unit price amount1 amount2
    m = cleaned.match(unitRe);
    if (m && /[A-Za-z]{2,}/.test(m[2])) {
      const qty = p(m[4]); const unit = m[5].toLowerCase(); const unitPrice = p(m[6]);
      const taxOrNet = p(m[7]); const total = p(m[8]);
      if (qty >= 1 && qty <= 10000000) {
        const expectedNet = qty * unitPrice;
        let netValue, taxAmount;
        if (Math.abs(expectedNet - taxOrNet) <= Math.max(1, taxOrNet * 0.02)) {
          netValue = taxOrNet; taxAmount = total - netValue;
        } else {
          netValue = expectedNet; taxAmount = taxOrNet;
        }
        items.push({ item_no: parseInt(m[1]) || null, description: m[2].trim(), hsn_code: m[3], quantity: qty, unit, unit_price: unitPrice, net_value: netValue, tax_amount: Math.abs(taxAmount) > 0.01 ? Math.round(taxAmount * 100) / 100 : null, currency });
        continue;
      }
    }

    // P3: Wide numeric â item# desc HSN price qty net tax total (8 fields)
    m = cleaned.match(wideRe);
    if (m && /[A-Za-z]{2,}/.test(m[2])) {
      const qty = p(m[5]);
      if (qty > 0 && qty <= 10000000) {
        let unitPrice = p(m[4]); let netValue = p(m[6]); let taxAmount = p(m[7]); const total = p(m[8]);
        // Fix â¹âleading-digit artifacts
        const stripLead = (v) => { const s = String(v); return s.length > 1 ? parseFloat(s.slice(1)) : NaN; };
        const sp = stripLead(unitPrice);
        if (!isNaN(sp) && sp > 0) {
          const en = qty * sp;
          if (Math.abs(en - netValue) <= Math.max(1, netValue * 0.02)) { unitPrice = sp; }
          else { const sn = stripLead(netValue); if (!isNaN(sn) && Math.abs(en - sn) <= Math.max(1, sn * 0.02)) { unitPrice = sp; netValue = sn; } }
        }
        if (total > 0 && netValue > 0 && netValue < total) {
          const dt = Math.round((total - netValue) * 100) / 100;
          if (taxAmount > total || taxAmount > netValue * 10) taxAmount = dt;
          const st = stripLead(taxAmount);
          if (!isNaN(st) && st > 0 && Math.abs(netValue + st - total) <= Math.max(1, total * 0.02)) taxAmount = st;
        }
        items.push({ item_no: parseInt(m[1]) || null, description: m[2].trim(), hsn_code: m[3], quantity: qty, unit: null, unit_price: unitPrice, net_value: netValue, tax_amount: taxAmount, currency });
        continue;
      }
    }

    // P2b: item# desc HSN qty unit price net tax% total (9-field)
    m = cleaned.match(unitTaxPctRe);
    if (m && /[A-Za-z]{2,}/.test(m[2])) {
      const qty = p(m[4]); const unit = m[5].toLowerCase(); const unitPrice = p(m[6]);
      const netValue = p(m[7]); const gstRate = parseFloat(m[8]); const total = p(m[9]);
      if (qty >= 1 && qty <= 10000000 && unitPrice > 0) {
        let taxAmount = null;
        if (gstRate > 0 && netValue > 0) taxAmount = Math.round(netValue * (gstRate / 100) * 100) / 100;
        if (!taxAmount && total > netValue) taxAmount = Math.round((total - netValue) * 100) / 100;
        items.push({ item_no: parseInt(m[1]) || null, description: m[2].trim(), hsn_code: m[3], quantity: qty, unit, unit_price: unitPrice, net_value: netValue, tax_amount: taxAmount, currency });
        continue;
      }
    }

    // P2c: item# desc HSN qty unit price net (7-field, 2 amounts after unit)
    m = cleaned.match(unitShortRe);
    if (m && /[A-Za-z]{2,}/.test(m[2])) {
      const qty = p(m[4]); const unit = m[5].toLowerCase(); const unitPrice = p(m[6]);
      const netValue = p(m[7]);
      if (qty >= 1 && qty <= 10000000 && unitPrice > 0) {
        let taxAmount = null;
        const expectedNet = qty * unitPrice;
        if (Math.abs(expectedNet - netValue) > Math.max(1, netValue * 0.02)) {
          // netValue might be gross; tax = net - expected
          taxAmount = Math.round((netValue - expectedNet) * 100) / 100;
          if (taxAmount < 0) taxAmount = null;
        }
        items.push({ item_no: parseInt(m[1]) || null, description: m[2].trim(), hsn_code: m[3], quantity: qty, unit, unit_price: unitPrice, net_value: netValue, tax_amount: taxAmount, currency });
        continue;
      }
    }

    // P2c: desc HSN qty unit price net (no item#)
    m = cleaned.match(unitNoItemRe);
    if (m && /[A-Za-z]{2,}/.test(m[1])) {
      const qty = p(m[3]); const unit = m[4].toLowerCase(); const unitPrice = p(m[5]);
      const netValue = p(m[6]);
      if (qty >= 1 && qty <= 10000000 && unitPrice > 0) {
        let taxAmount = null;
        const expectedNet = qty * unitPrice;
        if (Math.abs(expectedNet - netValue) > Math.max(1, netValue * 0.02)) {
          taxAmount = Math.round((netValue - expectedNet) * 100) / 100;
          if (taxAmount < 0) taxAmount = null;
        }
        items.push({ item_no: null, description: m[1].trim(), hsn_code: m[2], quantity: qty, unit, unit_price: unitPrice, net_value: netValue, tax_amount: taxAmount, currency });
        continue;
      }
    }

    // P2d: item# desc HSN qty unit price (6-field, net = qty * price)
    m = cleaned.match(unitMinRe);
    if (m && /[A-Za-z]{2,}/.test(m[2])) {
      let qty = p(m[4]); const unit = m[5].toLowerCase(); const unitPrice = p(m[6]);
      // "Qty Unit Rate per-Unit Amount" with the leading "1 <unit>" quantity
      // column dropped by OCR: the same value lands in both the qty and
      // price groups (e.g. "3,30,586.00 Set 3,30,586.00"). Treat as qty=1
      // rather than squaring the rate into net_value.
      if (qty === unitPrice && qty > 100 && /\./.test(m[4])) qty = 1;
      if (qty >= 1 && qty <= 10000000 && unitPrice > 0) {
        const netValue = Math.round(qty * unitPrice * 100) / 100;
        items.push({ item_no: parseInt(m[1]) || null, description: m[2].trim(), hsn_code: m[3], quantity: qty, unit, unit_price: unitPrice, net_value: netValue, tax_amount: null, currency });
        continue;
      }
    }

    // P3b: Tally inverted â item# desc amount unit rate qty unit HSN (and variants with extra fields)
    {
      // Standard: item# desc amount unit rate qty unit HSN
      const tallyInvRe = new RegExp(`^(\\d+)\\s+(.+?)\\s+([\\d,]+(?:\\.\\d{1,2})?)\\s+(${UNIT_LIST})\\s+([\\d,]+(?:\\.\\d{1,2})?)\\s+([\\d,]+(?:\\.\\d{1,3})?)\\s+(?:${UNIT_LIST})\\s+(\\d{4,8})$`, "i");
      m = cleaned.match(tallyInvRe);
      if (m && /[A-Za-z]{2,}/.test(m[2])) {
        const netValue = p(m[3]); const unit = m[4].toLowerCase(); const unitPrice = p(m[5]); const qty = p(m[6]); const hsn = m[7];
        if (qty > 0 && qty <= 10000000 && unitPrice > 0 && Math.abs(qty * unitPrice - netValue) <= Math.max(1, netValue * 0.05)) {
          items.push({ item_no: parseInt(m[1]) || null, description: m[2].trim(), hsn_code: hsn, quantity: qty, unit, unit_price: unitPrice, net_value: netValue, tax_amount: null, currency });
          continue;
        }
      }
      // Extended: item# desc amount unit rate total qty unit HSN
      const tallyExtRe = new RegExp(`^(\\d+)\\s+(.+?)\\s+([\\d,]+(?:\\.\\d{1,2})?)\\s+(${UNIT_LIST})\\s+([\\d,]+(?:\\.\\d{1,2})?)\\s+[\\d,]+(?:\\.\\d{1,2})?\\s+(\\d+)\\s+(?:${UNIT_LIST})\\s+(\\d{4,8})$`, "i");
      m = cleaned.match(tallyExtRe);
      if (m && /[A-Za-z]{2,}/.test(m[2])) {
        const netValue = p(m[3]); const unit = m[4].toLowerCase(); const unitPrice = p(m[5]); const qty = p(m[6]); const hsn = m[7];
        if (qty > 0 && qty <= 10000000 && unitPrice > 0 && Math.abs(qty * unitPrice - netValue) <= Math.max(1, netValue * 0.05)) {
          items.push({ item_no: parseInt(m[1]) || null, description: m[2].trim(), hsn_code: hsn, quantity: qty, unit, unit_price: unitPrice, net_value: netValue, tax_amount: null, currency });
          continue;
        }
      }
    }

    // P4: 6-field with HSN â item# desc HSN qty price net
    m = cleaned.match(hsn6Re);
    if (m && /[A-Za-z]{2,}/.test(m[2])) {
      const qty = p(m[4]); const rate = p(m[5]); const amt = p(m[6]);
      if (qty > 0 && qty < 100000 && rate > 0) {
        items.push({ item_no: parseInt(m[1]), description: m[2].trim(), hsn_code: m[3], quantity: qty, unit: null, unit_price: rate, net_value: amt, tax_amount: null, currency });
        continue;
      }
    }

    // P5: 5-field with item# â item# desc qty price net
    m = cleaned.match(fiveRe);
    if (m && /[A-Za-z]{2,}/.test(m[2])) {
      const qty = p(m[3]); const rate = p(m[4]); const amt = p(m[5]);
      if (qty > 0 && qty < 100000 && rate > 0) {
        items.push({ item_no: parseInt(m[1]) || null, description: m[2].trim(), hsn_code: null, quantity: qty, unit: null, unit_price: rate, net_value: amt, tax_amount: null, currency });
        continue;
      }
    }

    // P6: 4-field no item# â desc qty price net
    m = cleaned.match(fourRe);
    if (m && /[A-Za-z]{2,}/.test(m[1])) {
      const qty = p(m[2]); const rate = p(m[3]); const amt = p(m[4]);
      if (qty > 0 && qty < 100000 && rate > 0) {
        items.push({ item_no: null, description: m[1].trim(), hsn_code: null, quantity: qty, unit: null, unit_price: rate, net_value: amt, tax_amount: null, currency });
        continue;
      }
    }
  }
  return items;
}

// Phase 3a: Multi-line items (amounts on subsequent lines)
function extractMultiLineItems(lines, currency) {
  const items = [];
  const spacedRe = new RegExp(`^(\\d+)\\s+(.+?)\\s+(\\d{4,8})\\s+([\\d,]+(?:\\.\\d+)?)\\s*(${UNIT_LIST})\\s+(?:[â¹$â¬Â£Â¥]\\s*)?([\\d,]+(?:\\.\\d{1,2})?)$`, "i");
  const concatRe = new RegExp(`^(\\d+)([A-Z][A-Za-z\\s]+?)(\\d{4,8})(\\d+)(${UNIT_LIST})[â¹$â¬Â£Â¥]\\s*([\\d,]+(?:\\.\\d{1,2})?)$`, "i");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cleaned = line.replace(/[â¹$â¬Â£Â¥]/g, "").replace(/\s{2,}/g, " ").trim();
    let m = cleaned.match(spacedRe);
    let isConcat = false;
    if (!m) { m = line.match(concatRe); isConcat = !!m; }
    if (!m) continue;
    if (!isConcat && !/[A-Za-z]{2,}/.test(m[2])) continue;

    const qty = parseFloat(m[4].replace(/,/g, ""));
    const unitPrice = parseFloat(m[6].replace(/,/g, ""));
    if (qty < 1 || qty > 10000000 || !unitPrice) continue;

    const followingAmounts = [];
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      const fl = lines[j].trim();
      if (/^\d+\s+[A-Z]/i.test(fl) || /^\d+[A-Z]/i.test(fl)) break;
      if (/^(sub\s*total|total|grand|balance|received|invoice)/i.test(fl)) break;
      const amtMatch = fl.replace(/[â¹$â¬Â£Â¥]/g, "").trim().match(/^([\d,]+(?:\.\d{1,2})?)$/);
      if (amtMatch) followingAmounts.push(parseFloat(amtMatch[1].replace(/,/g, "")));
    }

    const netValue = qty * unitPrice;
    let taxAmount = null;
    if (followingAmounts.length >= 2) {
      const pt = followingAmounts[0]; const pp = followingAmounts[followingAmounts.length - 1];
      if (Math.abs(netValue + pt - pp) <= Math.max(1, pp * 0.02)) taxAmount = pt;
      else taxAmount = pp > netValue ? Math.round((pp - netValue) * 100) / 100 : pt;
    } else if (followingAmounts.length === 1) {
      const fa = followingAmounts[0];
      taxAmount = fa > netValue ? Math.round((fa - netValue) * 100) / 100 : fa;
    }

    items.push({ item_no: parseInt(m[1]), description: m[2].trim(), hsn_code: m[3], quantity: qty, unit: m[5].toLowerCase(), unit_price: unitPrice, net_value: Math.round(netValue * 100) / 100, tax_amount: taxAmount, currency });
  }
  return items;
}

// Phase 3b: Concatenated number strings from PDF tables
function extractConcatenatedItems(lines, currency) {
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const concatMatch = line.match(/^(\d{6})([\d.%]+)$/);
    if (!concatMatch) continue;

    const hsnCode = concatMatch[1];
    const dataStr = concatMatch[2];
    const tokens = [];
    let pos = 0;
    while (pos < dataStr.length) {
      const pctM = dataStr.substring(pos).match(/^(\d+(?:\.\d+)?%)/);
      if (pctM) { tokens.push(pctM[1]); pos += pctM[1].length; continue; }
      const decM = dataStr.substring(pos).match(/^(\d+\.\d{2})/);
      if (decM) { tokens.push(decM[1]); pos += decM[1].length; continue; }
      const intM = dataStr.substring(pos).match(/^(\d+)/);
      if (intM) { tokens.push(intM[1]); pos += intM[1].length; continue; }
      pos++;
    }

    const numTokens = tokens.filter(t => !t.includes('%')).map(t => parseFloat(t));
    if (numTokens.length < 3) continue;

    const total = numTokens[numTokens.length - 1];
    let qty = 1, price = null, taxable = null;

    const decimalTokens = numTokens.filter(n => n > 0 && n < total);
    const valueCounts = {};
    for (const v of decimalTokens) valueCounts[v] = (valueCounts[v] || 0) + 1;
    for (const [val, count] of Object.entries(valueCounts)) {
      if (count >= 2 && parseFloat(val) > 0) { taxable = parseFloat(val); price = taxable; break; }
    }
    if (!taxable) {
      const intPart = String(Math.floor(numTokens[0]));
      for (let qLen = 1; qLen <= Math.min(2, intPart.length - 1); qLen++) {
        const tryQty = parseInt(intPart.substring(0, qLen));
        const decPart = tokens[0].includes('.') ? tokens[0].split('.')[1] : '00';
        const tryPrice = parseFloat(intPart.substring(qLen) + '.' + decPart);
        if (tryQty >= 1 && tryQty <= 100 && tryPrice > 0 && tryPrice <= total) { qty = tryQty; price = tryPrice; taxable = price; break; }
      }
    }
    if (!price) { price = total; taxable = total; }

    let desc = "";
    for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
      const prevLine = lines[j];
      if (/^(product|item|description|sac|code|qty|rate|amount|total|hsn|rateamount)/i.test(prevLine)) break;
      if (/^\d{6}/.test(prevLine)) break;
      if (/[A-Za-z]{2,}/.test(prevLine)) desc = prevLine + (desc ? " " + desc : "");
    }

    const taxTokens = tokens.slice(4, -1);
    const taxAmounts = [];
    for (const t of taxTokens) { if (!t.includes('%') && t.includes('.')) taxAmounts.push(parseFloat(t)); }
    const totalItemTax = taxAmounts.reduce((s, v) => s + v, 0);

    if (desc && total > 0) {
      items.push({ item_no: null, description: desc.trim(), hsn_code: hsnCode, quantity: qty, unit: null, unit_price: price, net_value: taxable, tax_amount: totalItemTax > 0 ? Math.round(totalItemTax * 100) / 100 : null, currency });
    }
  }
  return items;
}

// Phase 3c: Description / qty / rate / amount on separate lines
function extractSequentialItems(lines, currency) {
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/[A-Za-z]{2,}/.test(line)) continue;
    if (/^(s\.?\s*no|sl|#|qty|rate|amount|hsn|sac|gst|tax|total|sub|net|grand|invoice|bill|date|to\b|from\b|address|phone|email|gstin|pan\b|place|state|bank|a\/c|ifsc|payment|for\b|mob|pin|lorry|receiver|authorized|signatory|original|recipient|description\s*of)/i.test(line)) continue;
    if (/qty.*rate.*amount/i.test(line)) continue;
    if (/s\.?\s*gst|c\.?\s*gst|igst|sgst|cgst/i.test(line)) continue;
    if (/GSTIN|GSTR|GST\s*No/i.test(line)) continue;

    const numLines = [];
    let lastNumIdx = -1;
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      const candidate = lines[j].trim();
      if (/^[\d,.]+$/.test(candidate) && candidate.length >= 1) {
        numLines.push(parseFloat(candidate.replace(/,/g, "")));
        lastNumIdx = j;
      } else if (/[A-Za-z]/.test(candidate)) break;
    }

    if (numLines.length >= 3) {
      const qty = numLines[0]; const rate = numLines[1]; const amount = numLines[2];
      if (qty > 0 && rate > 0 && amount > 0 && Math.abs(qty * rate - amount) < amount * 0.01 + 1) {
        items.push({ item_no: null, description: line.replace(/^\d+[\s.)]*/, "").trim(), hsn_code: null, quantity: qty, unit: null, unit_price: rate, net_value: amount, tax_amount: null, currency });
        i = lastNumIdx; continue;
      }
    }

    if (numLines.length >= 2) {
      const numStr = String(numLines[0]); const amount = numLines[1];
      if (!amount || amount <= 0) continue;
      let foundQty = null, foundRate = null;
      const dotIdx = numStr.indexOf(".");
      if (dotIdx > 0) {
        const intPart = numStr.substring(0, dotIdx); const decPart = numStr.substring(dotIdx);
        for (let qLen = 1; qLen <= intPart.length - 1; qLen++) {
          const tryQty = parseInt(intPart.substring(0, qLen));
          const tryRate = parseFloat(intPart.substring(qLen) + decPart);
          if (tryQty > 0 && tryRate > 0 && Math.abs(tryQty * tryRate - amount) < 1) { foundQty = tryQty; foundRate = tryRate; break; }
        }
      } else {
        for (let qLen = 1; qLen <= numStr.length - 1; qLen++) {
          const tryQty = parseInt(numStr.substring(0, qLen));
          const tryRate = parseFloat(numStr.substring(qLen));
          if (tryQty > 0 && tryRate > 0 && Math.abs(tryQty * tryRate - amount) < 1) { foundQty = tryQty; foundRate = tryRate; break; }
        }
      }
      if (foundQty && foundRate) {
        items.push({ item_no: null, description: line.replace(/^\d+[\s.)]*/, "").trim(), hsn_code: null, quantity: foundQty, unit: null, unit_price: foundRate, net_value: amount, tax_amount: null, currency });
        i = lastNumIdx;
      }
    }
  }
  return items;
}

// Phase 3d: SAP Purchase Order tabular format
function extractSapPoItems(lines, currency) {
  const items = [];
  const poItemRegex = /^(\d{5})(\d{7,})\s*(.+)/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const poMatch = line.match(poItemRegex);
    if (!poMatch) continue;

    let desc = poMatch[3].trim();
    if (/^(Description|Item\s*ID|HSN)/i.test(desc)) continue;

    if (i + 1 < lines.length) {
      const nextLine = lines[i + 1].trim();
      if (/[A-Za-z]/.test(nextLine) && !/^\d{5,}/.test(nextLine) && !/^Taxes:/i.test(nextLine)
          && !/^\d+\s*(kg|l|nos|pcs)/i.test(nextLine) && !/INR/i.test(nextLine)
          && (desc.endsWith("-") || desc.endsWith("â"))) {
        desc = desc + " " + nextLine; i++;
      }
    }

    let hsnCode = "";
    if (i + 1 < lines.length) {
      const hsnLine = lines[i + 1].trim();
      if (/^\d{4,8}$/.test(hsnLine)) { hsnCode = hsnLine; i++; }
    }

    let qtyFromDesc = null;
    const descQtyMatch = desc.match(/^(.+?)\s+([\d,.]+)$/);
    if (descQtyMatch) { desc = descQtyMatch[1].trim(); qtyFromDesc = descQtyMatch[2]; }

    let qty = null, unitPrice = null, netValue = null, taxAmt = null, unit = null;

    for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
      const nextLine = lines[j].trim();
      if (poItemRegex.test(nextLine)) break;
      if (/^Taxes:/i.test(nextLine)) break;

      const uomMatch = nextLine.match(new RegExp(`^\\d+(?:\\.\\d+)?\\s*(${UNIT_LIST})`, "i"));
      if (uomMatch && !unit) unit = uomMatch[1].toLowerCase();

      if (qty === null && (/^[\d,.]+$/.test(nextLine) || qtyFromDesc !== null)) {
        const qtyPart = qtyFromDesc || nextLine.replace(/,/g, "");
        const nextIdx = qtyFromDesc ? j : j + 1;
        const nextNext = (nextIdx < lines.length) ? lines[nextIdx].trim() : "";
        if (new RegExp(`^\\d{2}\\s*(${UNIT_LIST})`, "i").test(nextNext)) {
          qty = parseFloat(qtyPart.replace(/,/g, "") + nextNext.match(/^(\d+)/)[1]);
          unit = nextNext.match(new RegExp(`(${UNIT_LIST})`, "i"))[1].toLowerCase();
          if (qtyFromDesc) qtyFromDesc = null; else j = nextIdx;
          continue;
        }
        qtyFromDesc = null;
      }

      const priceMatch = nextLine.match(/([\d,.]+)\s*INR/i);
      if (priceMatch && unitPrice === null && qty !== null) {
        const nextNext = (j + 1 < lines.length) ? lines[j + 1].trim() : "";
        if (/^per\s+\d/i.test(nextNext)) { unitPrice = parseFloat(priceMatch[1].replace(/,/g, "")); j++; continue; }
      }
      if (priceMatch && unitPrice !== null && netValue === null) {
        netValue = parseFloat(priceMatch[1].replace(/,/g, ""));
        const nextNext = (j + 1 < lines.length) ? lines[j + 1].trim() : "";
        if (nextNext === "INR") j++;
        continue;
      }
      if (netValue === null && unitPrice !== null && /^[\d,]+(?:\.\d{1,2})?$/.test(nextLine)) {
        const nextNext = (j + 1 < lines.length) ? lines[j + 1].trim() : "";
        if (nextNext === "INR") { netValue = parseFloat(nextLine.replace(/,/g, "")); j++; continue; }
      }
      if (netValue !== null && taxAmt === null && priceMatch) {
        taxAmt = parseFloat(priceMatch[1].replace(/,/g, ""));
        break;
      }
    }

    let itemCgst = 0, itemSgst = 0, itemIgst = 0;
    for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
      const tl = lines[j].trim();
      if (poItemRegex.test(tl)) break;
      const cm = tl.match(/Central\s*GST\s*[\d.]+\s*%\s*([\d,.]+)\s*INR/i);
      if (cm) { itemCgst = parseFloat(cm[1].replace(/,/g, "")); continue; }
      const sm = tl.match(/State\s*GST\s*[\d.]+\s*%\s*([\d,.]+)\s*INR/i);
      if (sm) { itemSgst = parseFloat(sm[1].replace(/,/g, "")); continue; }
      const im = tl.match(/Integrated\s*GST\s*[\d.]+\s*%\s*([\d,.]+)\s*INR/i);
      if (im) { itemIgst = parseFloat(im[1].replace(/,/g, "")); continue; }
    }

    if (desc && netValue !== null && netValue > 0) {
      const totalTax = itemCgst + itemSgst + itemIgst;
      items.push({ item_no: parseInt(poMatch[1]) || null, description: desc, hsn_code: hsnCode || null, quantity: qty || 1, unit, unit_price: unitPrice || netValue, net_value: netValue, tax_amount: totalTax > 0 ? totalTax : (taxAmt || null), currency });
    }
  }
  return items;
}

// Phase 3e: Tally HSN-line format (HSN + amounts on one line, description above)
// Handles:  [item#] HSN [GST%] qty EA/unit price [total]
// Description is on preceding lines (looked up backwards)
function extractTallyHsnLineItems(lines, currency) {
  const items = [];
  const p = (s) => parseFloat(s.replace(/,/g, ""));
  const unitPat = `(${UNIT_LIST})`;

  // Pattern: [item#] HSN [pct %] qty unit price [total]
  const hsnLineRe = new RegExp(
    `^(?:(\\d+)\\s+)?(\\d{4,8})\\s+(?:\\d{1,2}(?:\\.\\d+)?\\s*%\\s+)?(\\d+(?:\\.\\d+)?)\\s+${unitPat}\\s+([\\d,]+(?:\\.\\d{1,2})?)(?:\\s+([\\d,]+(?:\\.\\d{1,2})?))?$`,
    "i"
  );

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const m = line.match(hsnLineRe);
    if (!m) continue;

    const itemNo = m[1] ? parseInt(m[1]) : null;
    const hsn = m[2];
    const qty = parseFloat(m[3]);
    const unit = m[4].toLowerCase();
    const price = p(m[5]);
    const total = m[6] ? p(m[6]) : null;

    if (qty <= 0 || price <= 0) continue;

    const netValue = total || Math.round(qty * price * 100) / 100;

    // Look backwards for description
    let desc = "";
    for (let j = i - 1; j >= Math.max(0, i - 15); j--) {
      const prev = lines[j].trim();
      // Stop at previous item's HSN line, header, or section boundary
      if (hsnLineRe.test(prev)) break;
      if (/^(s\.?\s*no|sl|description|particular|qty|rate|amount|hsn|total|sub\s*total|output|cgst|sgst|igst|grand|invoice|buyer|seller|consignee|dispatch|delivery|reference|e[\s-]?way)/i.test(prev)) break;
      if (/^\d{4,8}\s+\d/.test(prev)) break;
      // Skip pure number lines, percentage lines, "EA"/"NOS" lines
      if (/^[\d,.%\s]+$/.test(prev)) continue;
      if (new RegExp(`^${unitPat}\\.?$`, "i").test(prev)) continue;
      if (/^(continued|page\s*\d|tax\s*invoice)/i.test(prev)) break;
      // This is likely a description line
      if (/[A-Za-z]{2,}/.test(prev)) {
        const cleaned = prev.replace(/^\d+\s*/, "").trim(); // strip leading item#
        if (cleaned.length >= 2) {
          desc = cleaned + (desc ? " " + desc : "");
        }
      }
    }

    // Clean up description
    desc = desc.replace(/\s{2,}/g, " ").trim();
    if (!desc || desc.length < 2) continue;

    items.push({
      item_no: itemNo,
      description: desc,
      hsn_code: hsn,
      quantity: qty,
      unit,
      unit_price: price,
      net_value: netValue,
      tax_amount: null,
      currency,
    });
  }

  return items;
}

// Phase 3f: Zoho/Tally concatenated multi-line format
// Handles PDF text where table columns are concatenated without spaces:
//   Line N:   "1 Tri Sodium Phosphate"          (item# + description)
//   Line N+k: "28352300100.00"                   (HSN + qty concatenated)
//   Line N+k+1: "kg"                              (unit on separate line)
//   Line N+k+2: "54.009%486.009%486.005,400.00"  (rate + CGST% + CGST + SGST% + SGST + amount)
function extractZohoConcatItems(lines, currency) {
  const items = [];
  // Pattern: rate CGST% CGSTamt SGST% SGSTamt amount (all concatenated)
  const concatAmtRe = /^([\d,]+\.\d{2})(\d{1,2})%\s*([\d,]+\.\d{2})\s*(\d{1,2})%\s*([\d,]+\.\d{2})\s*([\d,]+\.\d{2})$/;
  // Also handle with spaces: "54.00   9%   486.00   9%   486.00   5,400.00"
  const spacedAmtRe = /^([\d,]+\.\d{2})\s+(\d{1,2})\s*%\s+([\d,]+\.\d{2})\s+(\d{1,2})\s*%\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})$/;
  // Same as above but the leading rate value wrapped onto the previous line
  // (e.g. "...3,500." / "00" / "9%315.009%315.003,500.00") and so is absent
  // here. `rate` is recovered from amount/qty below.
  const noRateAmtRe = /^(\d{1,2})\s*%\s*([\d,]+\.\d{2})\s*(\d{1,2})\s*%\s*([\d,]+\.\d{2})\s*([\d,]+\.\d{2})$/;
  const p = (s) => parseFloat(s.replace(/,/g, ""));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    let amtMatch = line.match(concatAmtRe);
    let rate = null, cgst, sgst, amount;
    if (amtMatch) {
      rate = p(amtMatch[1]); cgst = p(amtMatch[3]); sgst = p(amtMatch[5]); amount = p(amtMatch[6]);
    } else if ((amtMatch = line.match(spacedAmtRe))) {
      rate = p(amtMatch[1]); cgst = p(amtMatch[3]); sgst = p(amtMatch[5]); amount = p(amtMatch[6]);
    } else if ((amtMatch = line.match(noRateAmtRe))) {
      cgst = p(amtMatch[2]); sgst = p(amtMatch[4]); amount = p(amtMatch[5]);
    }
    if (!amtMatch || amount <= 0 || (rate != null && rate <= 0)) continue;

    // Look backwards for HSN+qty and description
    let hsn = null, qty = 1, unit = null, desc = "";
    for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
      const prev = lines[j].trim();

      // Unit line (e.g., "kg", "No.", "Nos")
      const unitRe = new RegExp(`^(${UNIT_LIST})\\.?$`, "i");
      if (unitRe.test(prev)) { unit = prev.replace(/\.$/, "").toLowerCase(); continue; }

      // Item# + description + HSN + qty + (truncated) rate all concatenated
      // on one line, e.g. "2 Transportation charges9965111.003,500." â the
      // rate's trailing "00" wrapped onto the next line, leaving a dangling
      // "3,500." here. `rate` is recomputed from amount/qty below.
      const descHsnQtyM = prev.match(/^\d+\s+(.+?)(\d{4,8})\s*(\d{1,2}(?:,\d{3})*\.\d{2})\s*[\d,]+\.$/);
      if (descHsnQtyM && !hsn) {
        desc = descHsnQtyM[1].trim() + (desc ? " " + desc : "");
        hsn = descHsnQtyM[2];
        qty = parseFloat(descHsnQtyM[3].replace(/,/g, ""));
        break;
      }

      // HSN+qty concatenated: "28352300100.00" or spaced: "28352300   100.00"
      const hsnQtyM = prev.match(/^(\d{4,8})\s*([\d,]+(?:\.\d+)?)$/);
      if (hsnQtyM) { hsn = hsnQtyM[1]; qty = parseFloat(hsnQtyM[2].replace(/,/g, "")); continue; }

      // Just HSN
      if (/^\d{4,8}$/.test(prev) && !hsn) { hsn = prev; continue; }

      // Description lines (with optional item# prefix)
      if (/[A-Za-z]{2,}/.test(prev) && !/^(sub\s*total|total|grand|balance|cgst|sgst|igst|irn|ack|hsn|amount|qty|rate)/i.test(prev)) {
        const descPart = prev.replace(/^\d+\s+/, "").trim();
        if (descPart.length >= 2) {
          desc = descPart + (desc ? " " + desc : "");
        }
        // Stop at item# prefix
        if (/^\d+\s+[A-Za-z]/.test(prev)) break;
      } else {
        if (desc) break;
      }
    }

    // Also check for "HSN: 90273020" style on a separate line
    if (!hsn) {
      for (let j = i - 1; j >= Math.max(0, i - 8); j--) {
        const hm = lines[j].trim().match(/^HSN\s*[:\-]?\s*(\d{4,8})$/i);
        if (hm) { hsn = hm[1]; break; }
      }
    }

    if (rate == null) {
      // Recovered via noRateAmtRe: the rate value wrapped onto another line
      // and wasn't captured. For these rows amount == rate * qty, so derive
      // rate directly from amount/qty.
      if (qty <= 0) continue;
      rate = amount / qty;
    }

    if (desc && amount > 0) {
      const totalTax = cgst + sgst;
      // Validate: rate * qty â amount
      const expectedAmt = rate * qty;
      if (qty > 1 && Math.abs(expectedAmt - amount) > amount * 0.05) {
        // qty might be wrong; recalculate
        qty = Math.round((amount / rate) * 1000) / 1000;
      }
      items.push({ item_no: null, description: desc.trim(), hsn_code: hsn, quantity: qty, unit, unit_price: rate, net_value: amount, tax_amount: totalTax > 0 ? totalTax : null, currency });
    }
  }
  return items;
}

// Phase 3g: Zoho/PDF multi-line items with concatenated HSN+qty
// Handles invoices where each item spans multiple lines:
//   item# + description start (concatenated or spaced)
//   description continuation lines
//   HSN+qty concatenated (e.g. "902780201.00") or spaced ("90278020   1.00")
//   unit on separate line (optional: "Pcs", "Set", etc.)
//   amounts on separate lines
function extractZohoMultiLineItems(lines, currency) {
  const items = [];
  const p = (s) => parseFloat(s.replace(/,/g, ""));
  const unitListRe = new RegExp(`^(${UNIT_LIST})\\.?$`, "i");

  // Find item start lines: "1Automatic" or "1   Automatic" or "2Auto Gas Filling"
  // Pattern: digit(s) followed by letter (start of description)
  const itemStartRe = /^(\d{1,3})\s*([A-Z][A-Za-z].*)/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const startM = line.match(itemStartRe);
    if (!startM) continue;

    const itemNo = parseInt(startM[1]);
    let desc = startM[2].trim();

    // Skip header lines
    if (/^(Item\s*Description|Description\s*of|Automatic\s*$)/i.test(line) && !/calorimeter|filling|spares|device|meter|coal|diesel|urea/i.test(desc)) {
      // Could be just "Automatic" â short descriptions are OK
    }
    if (/^(Sub\s*Total|Total|Grand|Balance|Invoice|Bill|Terms|Bank|Payment|GSTIN|PAN\b|IFSC|SWIFT|Declaration|Condition)/i.test(desc)) continue;

    // Collect description continuation + find HSN+qty
    let hsn = null, qty = null, unit = null;
    let amounts = [];
    let gstPct = null;
    let j = i + 1;

    // Phase A: collect description lines and find HSN
    for (; j < Math.min(i + 20, lines.length); j++) {
      const cl = lines[j].trim();

      // Check for concatenated HSN+qty: "902780201.00" (8-digit HSN + number)
      const concatM = cl.match(/^(\d{8})([\d,.]+)$/);
      if (concatM) {
        hsn = concatM[1];
        // The rest could be qty or qty+amounts concatenated
        const rest = concatM[2];
        // Try to parse as qty (small number like 1.00, 2.00)
        const qtyM = rest.match(/^(\d+\.\d+)/);
        if (qtyM) {
          qty = parseFloat(qtyM[1]);
          // Remaining after qty might be concatenated amounts
          const afterQty = rest.substring(qtyM[1].length);
          if (afterQty) {
            // Parse concatenated amounts (e.g., "0.000.00" = 0.00 + 0.00)
            const amtParts = afterQty.match(/[\d,]+\.\d{2}/g);
            if (amtParts) amtParts.forEach(a => amounts.push(p(a)));
          }
        }
        j++;
        break;
      }

      // Check for spaced HSN + qty: "90278020   1.00"
      const spacedM = cl.match(/^(\d{8})\s+([\d,.]+)$/);
      if (spacedM) {
        hsn = spacedM[1];
        qty = parseFloat(spacedM[2].replace(/,/g, ""));
        j++;
        break;
      }

      // Check for just HSN alone
      if (/^\d{8}$/.test(cl) && !hsn) {
        hsn = cl;
        continue;
      }

      // Stop if we hit another item start, header, or totals
      if (itemStartRe.test(cl) && /^(\d{1,3})\s*[A-Z]/i.test(cl)) break;
      if (/^(total|sub\s*total|grand|balance|terms|bank|igst|cgst|sgst|#\s*Item)/i.test(cl)) break;

      // Description continuation
      if (/[A-Za-z]{2,}/.test(cl) && !/^(total|sub|grand|balance|igst|cgst|sgst)/i.test(cl)) {
        desc += " " + cl;
      }
    }

    if (!hsn || qty === null) continue;

    // Phase B: collect unit and amounts from following lines
    for (; j < Math.min(i + 25, lines.length); j++) {
      const cl = lines[j].trim();

      // Next item start â stop
      if (itemStartRe.test(cl) && /^\d{1,3}\s*[A-Z]/i.test(cl)) break;
      if (/^(total|sub\s*total|grand|terms|bank|#\s*Item)/i.test(cl)) break;
      // Next HSN line â stop
      if (/^\d{8}/.test(cl)) break;

      // Unit line
      if (unitListRe.test(cl)) { unit = cl.replace(/\.$/, "").toLowerCase(); continue; }

      // GST percentage
      const pctM = cl.match(/^(\d+(?:\.\d+)?)\s*%$/);
      if (pctM) { gstPct = parseFloat(pctM[1]); continue; }

      // Amount line (with possible Indian comma notation like "4,80,000.00")
      if (/^[\d,]+\.\d{1,2}$/.test(cl)) {
        amounts.push(p(cl));
        continue;
      }

      // Partial amount (e.g., "4,80,000.0" followed by "0" on next line)
      if (/^[\d,]+\.\d$/.test(cl) && j + 1 < lines.length) {
        const nextCl = lines[j + 1].trim();
        if (/^\d$/.test(nextCl)) {
          amounts.push(p(cl + nextCl));
          j++;
          continue;
        }
      }

      // "0" alone (part of a split amount or qty)
      if (/^\d$/.test(cl)) continue;

      // IGST label with amount concatenated: "IGST18 (18%)86,400.00"
      if (/^IGST/i.test(cl)) break;
    }

    // Clean description
    desc = desc.replace(/\s{2,}/g, " ").replace(/\/M\d+\s*$/, "").trim();
    if (!desc || desc.length < 3) continue;
    if (/^(Item\s*Description|HSN)/i.test(desc)) continue;

    // Determine net_value and tax_amount from collected amounts
    // For items with 0 amounts (free items in proforma), skip or keep with 0
    let netValue = 0, taxAmount = null;

    if (amounts.length >= 3) {
      // Likely: rate, igst, amount (or amount, igst, amount)
      // The largest repeated value is the net_value
      const sorted = [...amounts].sort((a, b) => b - a);
      netValue = sorted[0];
      // Find IGST amount
      for (const a of amounts) {
        if (a !== netValue && a > 0) {
          if (gstPct && Math.abs(netValue * gstPct / 100 - a) < Math.max(1, a * 0.02)) {
            taxAmount = a;
            break;
          }
        }
      }
      if (!taxAmount && amounts.length >= 2) {
        // Second amount might be tax
        const nonNet = amounts.filter(a => a !== netValue && a > 0);
        if (nonNet.length > 0 && nonNet[0] < netValue) taxAmount = nonNet[0];
      }
    } else if (amounts.length === 2) {
      netValue = Math.max(amounts[0], amounts[1]);
      const smaller = Math.min(amounts[0], amounts[1]);
      if (smaller > 0 && smaller < netValue) taxAmount = smaller;
    } else if (amounts.length === 1) {
      netValue = amounts[0];
    }

    const unitPrice = qty > 0 && netValue > 0 ? Math.round((netValue / qty) * 100) / 100 : 0;

    items.push({
      item_no: itemNo,
      description: desc,
      hsn_code: hsn,
      quantity: qty,
      unit,
      unit_price: unitPrice,
      net_value: netValue,
      tax_amount: taxAmount,
      currency,
    });
  }

  return items;
}

// Phase 3h: Freight / Transport invoice
// Format: LR# date inv# from to vehicle# size type amount
// Each line is a truck shipment; the amount is always the last field.
function extractFreightItems(lines, currency) {
  const items = [];
  const p = (s) => parseFloat(s.replace(/,/g, ""));

  // Pattern: LR# date [inv] from to vehicle size [type] amount
  // Also handles concatenated format: "492417-04-2026 ... 1,88,500.00"
  const freightRe = /(\d{3,})\s+[\d][\d\-\/]+\s+[\d\-\/]+\s+(\w+)\s+(\w+)\s+([A-Z0-9]{6,})\s+(\d+\s*FEET)\s+\w+\s+([\d,]+\.\d{2})/i;
  // Also try: lines ending with Indian-format amount after FIX/FIXED/rate keyword
  const amountEndRe = /^.*?(\w{3,})\s+(\w{3,})\s+[A-Z0-9]{6,}\s+(\d+\s*FEET).*?([\d,]+\.\d{2})\s*$/i;

  // Find the table header to know we're in the right section
  let inTable = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Detect table header
    if (/LR\.?\s*NO.*RATE.*AMOUNT/i.test(line) || /LR\.?\s*NO.*VEHICLE.*AMOUNT/i.test(line)) {
      inTable = true;
      continue;
    }
    if (/^(TOTAL|AMOUNT\s*CHARGEABLE|BANK|A\/C|FOR\s+)/i.test(line)) {
      inTable = false;
      continue;
    }

    if (!inTable) continue;

    const m = line.match(freightRe);
    if (m) {
      const lrNo = m[1];
      const from = m[2];
      const to = m[3];
      const vehicle = m[4];
      const size = m[5].trim();
      const amount = p(m[6]);

      // Check for continuation line (route details like "MUMBAI RAR ODC")
      let route = `${from} to ${to}`;
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        if (/^[A-Z]{3,}\s+[A-Z]{2,}/i.test(nextLine) && !/^\d/.test(nextLine) && !/^(TOTAL|BANK|A\/C|FOR\s)/i.test(nextLine)) {
          const parts = nextLine.split(/\s+/);
          if (parts.length <= 4) route = `${parts[0]} to ${parts[1] || to}`;
        }
      }

      items.push({
        item_no: null,
        description: `Freight ${route} - LR#${lrNo} - ${vehicle} (${size})`,
        hsn_code: "996511",  // SAC code for road freight
        quantity: 1,
        unit: null,
        unit_price: amount,
        net_value: amount,
        tax_amount: null,
        currency,
      });
    }
  }

  return items;
}

// Phase 3i: Flexible arithmetic-based extraction
// Catches lines with description + 2-6 numbers where qty * price â amount.
// This is the last resort before giving up on line items.
function extractFlexibleItems(lines, currency) {
  const items = [];
  const unitRe = new RegExp(`\\b(${UNIT_LIST})\\b`, "i");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cleaned = normalizeLine(line);
    if (isHeaderOrMeta(cleaned)) continue;
    if (/^(sub\s*total|total|grand|net\s*amount|round|balance|received|invoice|bill\s*amount|freight|transport|e[\s-]?way)/i.test(cleaned)) continue;

    // Line must start with text (description) and contain numbers
    if (!/[A-Za-z]{2,}/.test(cleaned)) continue;

    // Split into text prefix and trailing numbers
    // Match: optional item#, text description, then 2+ numbers (possibly with unit in between)
    const trailingNums = [];
    let desc = "";
    let hsn = null;
    let unit = null;

    // Try to parse: [item#] desc [HSN] num num [num...]
    const tokens = cleaned.split(/\s+/);
    let numStart = -1;
    // Find where the numeric part starts (scanning from end)
    for (let t = tokens.length - 1; t >= 0; t--) {
      const tok = tokens[t].replace(/,/g, "");
      if (/^[\d]+(?:\.\d+)?$/.test(tok)) {
        numStart = t;
      } else if (unitRe.test(tokens[t])) {
        unit = tokens[t].toLowerCase();
        numStart = t;
      } else {
        break;
      }
    }

    if (numStart < 0 || numStart < 1) continue;

    // Extract description and numbers
    const textParts = tokens.slice(0, numStart);
    const numParts = tokens.slice(numStart);

    // Parse numbers (skip unit tokens)
    for (const np of numParts) {
      const nClean = np.replace(/,/g, "");
      if (/^[\d]+(?:\.\d+)?$/.test(nClean)) {
        trailingNums.push(parseFloat(nClean));
      } else if (unitRe.test(np)) {
        unit = np.toLowerCase();
      }
    }

    if (trailingNums.length < 2) continue;

    // Build description - strip leading item number
    let itemNo = null;
    if (/^\d+$/.test(textParts[0]) && textParts.length > 1) {
      itemNo = parseInt(textParts[0]);
      textParts.shift();
    }

    // Check for HSN code (4-8 digit number at end of text parts)
    if (textParts.length > 1 && /^\d{4,8}$/.test(textParts[textParts.length - 1])) {
      hsn = textParts.pop();
    }

    desc = textParts.join(" ").trim();
    if (!desc || desc.length < 2 || !/[A-Za-z]{2,}/.test(desc)) continue;
    // Skip lines that look like GST/tax detail rows
    if (/^(c\.?\s*gst|s\.?\s*gst|igst|cgst|sgst|cess|tcs|tds)/i.test(desc)) continue;
    // A description wholly wrapped in brackets/parens (e.g. "(KRP AGENCY)")
    // is a logo or annotation, not an item â the trailing numbers are noise
    // from an adjacent phone number/code, not a qty/price/amount.
    if (/^[(\[].*[)\]]$/.test(desc)) continue;

    // Try arithmetic relationships to assign qty, price, net
    let bestMatch = null;

    // With 2 numbers: could be [price, net] or [qty, net]
    if (trailingNums.length === 2) {
      const [a, b] = trailingNums;
      // If first is small integer, treat as qty, second as net
      if (a >= 1 && a <= 10000 && a === Math.floor(a) && b > a) {
        bestMatch = { qty: a, unitPrice: Math.round((b / a) * 100) / 100, netValue: b, taxAmount: null };
      } else if (a > 0 && b > 0) {
        // Treat as price and net (qty=1)
        bestMatch = { qty: 1, unitPrice: a, netValue: b, taxAmount: null };
      }
    }

    // With 3 numbers: [qty, price, net]
    if (trailingNums.length === 3) {
      const [a, b, c] = trailingNums;
      if (a > 0 && b > 0 && c > 0 && Math.abs(a * b - c) <= Math.max(1, c * 0.02)) {
        bestMatch = { qty: a, unitPrice: b, netValue: c, taxAmount: null };
      } else if (a > 0 && b > 0 && c > b) {
        // Could be [qty, net, gross] or [price, net, gross]
        bestMatch = { qty: a, unitPrice: Math.round((b / a) * 100) / 100, netValue: b, taxAmount: Math.round((c - b) * 100) / 100 };
      }
    }

    // With 4+ numbers: try [qty, price, net, tax, ...] or [qty, price, disc, net, ...]
    if (trailingNums.length >= 4) {
      const nums = trailingNums;
      // Try each pair (i,j) where i<j as (qty, price) and find net â qty*price
      for (let ni = 0; ni < Math.min(nums.length - 1, 3); ni++) {
        for (let nj = ni + 1; nj < Math.min(nums.length, 4); nj++) {
          const q = nums[ni], r = nums[nj];
          if (q <= 0 || r <= 0) continue;
          const expected = q * r;
          for (let nk = nj + 1; nk < nums.length; nk++) {
            if (Math.abs(expected - nums[nk]) <= Math.max(1, nums[nk] * 0.02)) {
              const taxIdx = nums.length > nk + 1 ? nk + 1 : -1;
              bestMatch = { qty: q, unitPrice: r, netValue: nums[nk], taxAmount: taxIdx >= 0 ? nums[taxIdx] : null };
              break;
            }
          }
          if (bestMatch) break;
        }
        if (bestMatch) break;
      }
      // Fallback: last number as net, second-to-last as tax
      if (!bestMatch && nums.length >= 4) {
        const net = nums[nums.length - 2];
        const total = nums[nums.length - 1];
        if (total > net && net > 0) {
          bestMatch = { qty: nums[0], unitPrice: nums[1], netValue: net, taxAmount: Math.round((total - net) * 100) / 100 };
        }
      }
    }

    if (bestMatch && bestMatch.netValue > 0) {
      items.push({
        item_no: itemNo,
        description: desc,
        hsn_code: hsn,
        quantity: bestMatch.qty,
        unit,
        unit_price: bestMatch.unitPrice,
        net_value: bestMatch.netValue,
        tax_amount: bestMatch.taxAmount,
        currency,
      });
    }
  }
  return items;
}

// Phase 4: SAC-coded service-charge lines (e.g. "Freight on Sale")
// GST "Chapter 99" SAC codes (always 4-8 digits starting with "99") denote
// services rather than goods, and are often printed as a trailing line item
// with no quantity/rate columns at all â just "<item#> <description> <amount>
// <SAC code>". None of the same-line item patterns above match that shape, so
// such lines are silently dropped even when Phase 2/3 already found the goods
// line(s). Recover them as additional items (tax_amount is filled in later by
// postProcess's HSN/SAC tax-summary enrichment).
function extractServiceChargeItems(lines, items, currency) {
  const existingHsn = new Set(items.map((it) => it.hsn_code).filter(Boolean));
  const added = [];
  for (const line of lines) {
    const cleaned = normalizeLine(line);
    const m = cleaned.match(/^\d+\s+(.+?)\s+([\d,]+\.\d{2})\s+(99\d{2,6})$/);
    if (!m) continue;
    const [, desc, amountStr, hsn] = m;
    if (!/[A-Za-z]{2,}/.test(desc) || existingHsn.has(hsn)) continue;
    const amount = parseAmount(amountStr);
    if (!amount) continue;

    existingHsn.add(hsn);
    added.push({
      item_no: null,
      description: desc.trim(),
      hsn_code: hsn,
      quantity: 1,
      unit: null,
      unit_price: amount,
      net_value: amount,
      tax_amount: null,
      currency,
    });
  }
  return added;
}

// âââ Post-Processing: Enrichment, Artifact Correction, Dedup ââââââââââââââââ

function postProcess(items, text, lines, currency, sellerName) {
  // Enrich: extract HSN from nearby text if missing
  for (const item of items) {
    if (!item.hsn_code && item.description) {
      const descIdx = text.indexOf(item.description);
      if (descIdx >= 0) {
        const nearby = text.substring(descIdx, descIdx + 200);
        const hsnMatch = nearby.match(/\b(\d{4,8})\b/);
        if (hsnMatch && !/^\d{6,}$/.test(item.description)) item.hsn_code = hsnMatch[1];
      }
    }
  }

  // Fallback HSN enrichment: descriptions built by mergeGroup (longest variant,
  // trailing numbers stripped) or carrying a "|" column-separator/short OCR-noise
  // prefix often don't appear verbatim in the raw text, so the lookup above finds
  // nothing. Search the normalized (column-separators stripped) text instead, and
  // â since a single OCR pass may itself misread a digit of the HSN â take the
  // most common HSN seen across all matching occurrences.
  if (items.some((item) => !item.hsn_code && item.description)) {
    const normalizedText = lines.map(normalizeLine).join("\n");
    for (const item of items) {
      if (item.hsn_code || !item.description || /^\d{6,}$/.test(item.description)) continue;
      const searchDesc = item.description.replace(/^[A-Za-z]{1,2}\s+(?=[A-Z])/, "");
      if (searchDesc.length < 4) continue;
      const counts = {};
      let from = 0, idx;
      while ((idx = normalizedText.indexOf(searchDesc, from)) >= 0) {
        const hsnMatch = normalizedText.substring(idx, idx + 200).match(/\b(\d{4,8})\b/);
        if (hsnMatch) counts[hsnMatch[1]] = (counts[hsnMatch[1]] || 0) + 1;
        from = idx + 1;
      }
      const best = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
      if (best) item.hsn_code = best;
    }
  }

  // Enrich: fill in missing item-level tax amounts from the "HSN/SAC | Total
  // Tax Amount | ... | Taxable Value" summary table that GST invoices print
  // alongside the line items â row shape "<hsn> <totalTax> <amt> <rate>%
  // <amt> <rate>% <taxableValue>". Only applied when an item's own line
  // didn't carry a tax figure, so it never overrides an already-extracted value.
  if (items.some((item) => item.hsn_code && item.tax_amount == null)) {
    for (const item of items) {
      if (!item.hsn_code || item.tax_amount != null) continue;
      const sacRowRe = new RegExp(`^${item.hsn_code}\\s+([\\d,]+\\.\\d{2})\\s+[\\d,]+\\.\\d{2}\\s+\\d+(?:\\.\\d+)?%\\s+[\\d,]+\\.\\d{2}\\s+\\d+(?:\\.\\d+)?%\\s+[\\d,]+\\.\\d{2}$`);
      for (const l of lines) {
        const sm = normalizeLine(l).match(sacRowRe);
        if (sm) { item.tax_amount = parseAmount(sm[1]); break; }
      }
    }
  }

  // Enrich: extract unit from quantity text
  const qtyUnitRegex = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${UNIT_LIST})`, "gi");
  let qum;
  while ((qum = qtyUnitRegex.exec(text)) !== null) {
    for (const item of items) {
      if (!item.unit && item.quantity === parseFloat(qum[1])) item.unit = qum[2].toLowerCase();
    }
  }

  // Drop phantom rows whose description is a garbled re-parse of another
  // item's row from a differently-spaced OCR/digital-text pass â i.e. the
  // description starts with an item-number digit glued onto the next word
  // (e.g. "1SAFETY HELMET...") and literally contains another item's HSN
  // code and "<quantity><unit>" (e.g. "65061090 40Nos").
  const deglued = items.filter((item) => {
    const desc = item.description || "";
    if (!/^\d+[A-Za-z]/.test(desc)) return true;
    const descLower = desc.toLowerCase().replace(/\s+/g, "");
    return !items.some((other) => {
      if (other === item || !other.hsn_code || other.quantity == null || !other.unit) return false;
      return descLower.includes(other.hsn_code.toLowerCase()) && descLower.includes(`${other.quantity}${other.unit}`.toLowerCase());
    });
  });

  // Deduplicate items across OCR passes
  const deduped = dedupeLineItems(deglued);

  // Drop "ghost" rows left over from a second, truncated copy of the items
  // table in the OCR text (e.g. a duplicated accessibility text layer)
  const degosted = dropGhostDuplicates(deduped);

  // Remove items with no meaningful description, and any "item" whose
  // description is just the seller's own letterhead/company name â a
  // header/footer line (e.g. "(KRP AGENCY) <phone number>") that arithmetic
  // extraction mistook for a description + qty/price, not a real product row.
  const sellerNameLower = (sellerName || "").trim().toLowerCase();
  const filtered = degosted.filter(item =>
    item.description && /[A-Za-z]{2,}/.test(item.description) &&
    !(sellerNameLower && item.description.trim().toLowerCase() === sellerNameLower)
  );

  // Renumber items
  for (let i = 0; i < filtered.length; i++) filtered[i].item_no = i + 1;

  return filtered;
}

// âââ Main line item extraction (clean Phase 1/2/3 flow) âââââââââââââââââââââ

function extractLineItems(text, lines, rawLines, currency, sellerName) {
  // Phase 1: Specialized format detection (unique layouts)
  let items = extractCanonSapItems(lines, currency);
  if (items.length > 0) return postProcess(items, text, lines, currency, sellerName);

  items = extractCurrencyConcatItems(text, currency);
  if (items.length > 0) return postProcess(items, text, lines, currency, sellerName);

  // Phase 1c: e-Way Bill "Goods Details" section (present in all e-Invoices)
  items = extractEwayGoodsItems(lines, currency);
  if (items.length > 0) return postProcess(items, text, lines, currency, sellerName);

  // Phase 2: Unified same-line extraction (primary workhorse)
  items = extractSameLineItems(lines, currency);

  // Phase 3: Fallback strategies (only if Phase 2 found nothing)
  if (items.length === 0) items = extractMultiLineItems(lines, currency);
  if (items.length === 0) items = extractConcatenatedItems(lines, currency);
  if (items.length === 0) items = extractSequentialItems(lines, currency);
  if (items.length === 0) items = extractSapPoItems(lines, currency);
  if (items.length === 0) items = extractTallyHsnLineItems(lines, currency);
  if (items.length === 0) items = extractZohoConcatItems(lines, currency);
  if (items.length === 0) items = extractZohoMultiLineItems(lines, currency);
  if (items.length === 0) items = extractFreightItems(lines, currency);
  if (items.length === 0) items = extractFlexibleItems(lines, currency);

  // Phase 4: Recover SAC-coded service-charge lines (e.g. "Freight on Sale")
  // that Phase 2/3 missed because they lack quantity/rate columns
  items = items.concat(extractServiceChargeItems(lines, items, currency));

  return postProcess(items, text, lines, currency, sellerName);
}

// âââ Line-item deduplication helpers âââââââââââââââââââââââââââââââââââââââââ

function alphaTokens(s) {
  return (s || "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(t => t.length >= 2);
}

function sameAmount(a, b) {
  if (a == null || b == null) return false;
  if (Math.max(Math.abs(a), Math.abs(b)) <= 10) return false;
  if (Math.abs(a - b) <= Math.max(0.5, Math.abs(b) * 0.01)) return true;
  const stripLead = (x) => { const s = String(x); return s.length > 1 ? parseFloat(s.slice(1)) : NaN; };
  if (Math.abs(stripLead(a) - b) <= 0.5 || Math.abs(a - stripLead(b)) <= 0.5) return true;
  const tryRestoreDecimal = (big, small) => {
    if (big <= small * 50 || small <= 0) return false;
    const s = String(Math.round(big));
    if (s.length < 4) return false;
    const restored = parseFloat(s.slice(0, -2) + "." + s.slice(-2));
    if (Math.abs(restored - small) <= Math.max(0.5, small * 0.01)) return true;
    const stripped = parseFloat(s.slice(1, -2) + "." + s.slice(-2));
    return Math.abs(stripped - small) <= Math.max(0.5, small * 0.01);
  };
  if (tryRestoreDecimal(a, b) || tryRestoreDecimal(b, a)) return true;
  return false;
}

function countAmountMatches(a, b) {
  let direct = 0;
  if (sameAmount(a.unit_price, b.unit_price)) direct++;
  if (sameAmount(a.net_value, b.net_value)) direct++;
  if (sameAmount(a.tax_amount, b.tax_amount)) direct++;
  // Cross-field matches (OCR may swap unit_price/net_value columns)
  let cross = 0;
  if (sameAmount(a.unit_price, b.net_value) || sameAmount(a.net_value, b.unit_price)) cross++;
  return { direct, cross, total: direct + cross };
}

function sameLineItem(a, b) {
  const ta = alphaTokens(a.description);
  const tb = alphaTokens(b.description);

  // Both have no description: require 2+ amount matches
  if (ta.length === 0 && tb.length === 0) return countAmountMatches(a, b).total >= 2;

  // One has no description: absorb fragment only if 2+ amounts match
  if (ta.length === 0 || tb.length === 0) {
    if (sameAmount(a.net_value, b.net_value) && sameAmount(a.unit_price, b.unit_price)) return true;
    if (a.quantity != null && b.quantity != null && a.quantity === b.quantity) {
      if (countAmountMatches(a, b).total >= 2) return true;
      if (sameAmount(a.net_value, b.unit_price) || sameAmount(a.unit_price, b.net_value)) return true;
    }
    return false;
  }

  // Both have descriptions
  const [small, big] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (small.length < 2) return false;
  const bigSet = new Set(big);
  const overlap = small.filter(t => bigSet.has(t)).length;
  const { total, direct } = countAmountMatches(a, b);
  if (overlap < small.length) {
    // All three core amounts (unit_price, net_value, tax_amount) matching
    // exactly is decisive evidence the rows are two OCR fragments of the same
    // physical line item, even with completely disjoint descriptions â e.g.
    // one fragment is the item-metadata block ("Item No / ID / Serial No")
    // and the other is the actual product description.
    if (direct >= 3) return true;
    // Allow exactly one mismatched token â OCR garbles a single short
    // trailing word differently across passes (e.g. "10cm"/"10cha"/"10ch"
    // -> "cm"/"cha"/"ch", "(kemi)"/"(kem)" -> "kemi"/"kem") â if strong
    // amount evidence still ties the rows together.
    return small.length >= 2 && overlap >= small.length - 1 && total >= 2;
  }

  // Check for extra tokens in the bigger description
  const smallSet = new Set(small);
  const extraTokens = big.filter(t => !smallSet.has(t));
  const hasExtraWords = extraTokens.some(t => t.length >= 3);

  // If descriptions differ by substantial words, require strong evidence:
  // either 2+ direct matches, or 1 direct + 1 cross, or quantity match + any
  if (hasExtraWords) {
    if (total >= 2) return true;
    if (total >= 1 && a.quantity != null && b.quantity != null && a.quantity === b.quantity) return true;
    return false;
  }
  // If descriptions are identical/near-identical, 1 match is enough (OCR duplicate)
  if (total >= 1) return true;
  // Also merge if quantities match (covers small unit_price below sameAmount threshold)
  if (a.quantity != null && b.quantity != null && a.quantity === b.quantity) {
    if (sameAmount(a.net_value, b.net_value) || sameAmount(a.unit_price, b.unit_price)) return true;
  }
  return false;
}

function mergeGroup(group) {
  const score = (o) => [o.hsn_code, o.quantity, o.unit, o.unit_price, o.net_value, o.tax_amount].filter(v => v != null).length;
  // An item whose quantity * unit_price â net_value is far more trustworthy
  // than one with more populated fields but garbled arithmetic (e.g. a
  // misread digit derails extractFlexibleItems' qty/price/net assignment and
  // it falls back to using an HSN code as quantity). Prefer consistent items
  // as the merge base, breaking ties by field-completeness as before.
  const consistent = (o) => {
    if (o.quantity == null || o.unit_price == null || o.net_value == null) return false;
    const expected = o.quantity * o.unit_price;
    const tolerance = Math.max(1, Math.abs(o.net_value) * 0.02);
    return Math.abs(expected - o.net_value) <= tolerance;
  };
  const ranked = [...group].sort((a, b) => {
    const ca = consistent(a) ? 1 : 0;
    const cb = consistent(b) ? 1 : 0;
    if (ca !== cb) return cb - ca;
    return score(b) - score(a);
  });
  const base = { ...ranked[0] };
  // A tax_amount is only meaningful alongside arithmetic that checks out;
  // from an inconsistent item it's just whatever number the fallback
  // heuristic landed on (an HSN code remainder, a misread net_value, etc).
  if (!consistent(ranked[0])) base.tax_amount = null;

  for (const it of group) {
    for (const f of ["hsn_code", "quantity", "unit", "unit_price", "net_value", "tax_amount"]) {
      if (f === "tax_amount") {
        if (base[f] == null && it[f] != null && consistent(it)) base[f] = it[f];
        continue;
      }
      if (base[f] == null && it[f] != null) base[f] = it[f];
    }
    for (const f of ["unit_price", "net_value", "tax_amount"]) {
      if (base[f] != null && it[f] != null && base[f] > it[f]) {
        const s = String(base[f]);
        if (s.length > 1 && Math.abs(parseFloat(s.slice(1)) - it[f]) <= 0.5) base[f] = it[f];
      }
    }
    for (const f of ["unit_price", "net_value", "tax_amount"]) {
      if (base[f] != null && it[f] != null && base[f] !== it[f]) {
        const [big, small] = base[f] > it[f] ? [base[f], it[f]] : [it[f], base[f]];
        if (big > small * 50 && small > 0) {
          const s = String(Math.round(big));
          if (s.length >= 4) {
            const restored = parseFloat(s.slice(0, -2) + "." + s.slice(-2));
            if (Math.abs(restored - small) <= Math.max(0.5, small * 0.01)) base[f] = small;
          }
        }
      }
    }
  }

  // Prefer a genuine product-description fragment over an item-metadata
  // fragment (e.g. "Item No: 00010 ID: 7000062 Serial No: 2517024") when
  // picking which group member's description to keep â metadata fragments
  // can be the longest text yet are useless as a line-item description.
  const isMetaFragment = (d) => /^(item\s*no|id|serial\s*no|cat\.?\s*no|model\s*no|part\s*no|make)\s*[:.]?\s*\S/i.test(d);
  const descCandidates = [...group].map(g => g.description || "").filter(d => d);
  const nonMetaDescs = descCandidates.filter(d => !isMetaFragment(d));
  const descPool = nonMetaDescs.length ? nonMetaDescs : descCandidates;
  base.description = descPool.sort((a, b) => b.length - a.length)[0].replace(/(?:\s+\d[\d,.%]*)+\s*$/, "").trim();

  if (base.quantity && base.unit_price && base.net_value) {
    const expected = base.quantity * base.unit_price;
    const tolerance = Math.max(1, base.net_value * 0.02);
    if (Math.abs(expected - base.net_value) > tolerance) {
      const stripLead = (v) => { const s = String(v); return s.length > 1 ? parseFloat(s.slice(1)) : NaN; };
      const stripped = stripLead(base.unit_price);
      if (!isNaN(stripped) && stripped > 0) {
        const exp2 = base.quantity * stripped;
        if (Math.abs(exp2 - base.net_value) <= tolerance) base.unit_price = stripped;
        else { const sn = stripLead(base.net_value); if (!isNaN(sn) && Math.abs(exp2 - sn) <= Math.max(1, sn * 0.02)) { base.unit_price = stripped; base.net_value = sn; } }
      }
      if (Math.abs(base.quantity * base.unit_price - base.net_value) > tolerance) {
        const sn = stripLead(base.net_value);
        if (!isNaN(sn) && Math.abs(base.quantity * base.unit_price - sn) <= Math.max(1, sn * 0.02)) base.net_value = sn;
      }
      if (base.tax_amount) {
        const st = stripLead(base.tax_amount);
        if (!isNaN(st) && st > 0 && st < base.tax_amount && base.tax_amount > base.net_value * 5) base.tax_amount = st;
      }
      const restoreDecimal = (v) => { const s = String(Math.round(v)); return s.length >= 4 ? parseFloat(s.slice(0, -2) + "." + s.slice(-2)) : NaN; };
      if (Math.abs(base.quantity * base.unit_price - base.net_value) > tolerance) {
        const restored = restoreDecimal(base.net_value);
        if (!isNaN(restored) && Math.abs(base.quantity * base.unit_price - restored) <= Math.max(1, restored * 0.02)) base.net_value = restored;
      }
      if (base.tax_amount && base.net_value && base.tax_amount > base.net_value * 5) {
        const restored = restoreDecimal(base.tax_amount);
        if (!isNaN(restored) && restored > 0 && restored < base.net_value) base.tax_amount = restored;
      }
    }
  }

  return base;
}

function dedupeLineItems(items) {
  const groups = [];
  for (const item of items) {
    const g = groups.find(grp => grp.some(member => sameLineItem(member, item)));
    if (g) g.push(item);
    else groups.push([item]);
  }
  return groups.map(mergeGroup);
}

// Some PDFs print the items table twice in their text layer â once tightly
// packed and again spaced out (e.g. an accessibility text layer) â and the
// second copy's truncated rows survive dedup as separate "ghost" items: zero
// amounts, and a description that's just the leading word(s) of a real
// item's description. Drop a zero-value item if another item shares its HSN
// + quantity and that item's description is a superset of this one's words.
function dropGhostDuplicates(items) {
  if (items.length <= 1) return items;
  const tokenSets = items.map(it => new Set(alphaTokens(it.description)));
  return items.filter((item, idx) => {
    if (item.unit_price || item.net_value || item.tax_amount) return true;
    const tokens = tokenSets[idx];
    return !items.some((other, j) => {
      if (j === idx) return false;
      if (other.hsn_code !== item.hsn_code || other.quantity !== item.quantity) return false;
      const otherTokens = tokenSets[j];
      return otherTokens.size > tokens.size && [...tokens].every(t => otherTokens.has(t));
    });
  });
}

// Drop phantom "summary / totals" rows that leaked in as line items. The merged
// multi-pass OCR text frequently mis-reads the invoice's Net/Tax/Grand-Total
// footer (e.g. "â¹586.24 â¹413.76 â¹1,000.00") as an extra row whose net_value or
// unit_price equals the whole-invoice grand total. A genuine line item can never
// equal the grand total when other line items also exist (the total is their
// sum), so such a row is the footer, not a product. Only prune when the grand
// total is known and more than one item survives, and never prune every row.
function dropSummaryRows(items, totals) {
  if (!totals || !totals.grand_total || items.length <= 1) return items;
  const gt = totals.grand_total;
  const near = (v) => v != null && Math.abs(v - gt) <= Math.max(0.5, gt * 0.01);
  const kept = items.filter(it => !(near(it.net_value) || near(it.unit_price)));
  return kept.length > 0 && kept.length < items.length ? kept : items;
}

// âââ Tax Extraction ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

function extractTaxes(text, lines) {
  const taxes = { cgst: null, sgst: null, igst: null, totalTax: null };

  // SAP PO Tax Summary format
  const sapTaxMap = { cgst: /Total\s+IN:\s*Central\s*GST/i, sgst: /Total\s+IN:\s*State\s*GST/i, igst: /Total\s+IN:\s*Integrated\s*GST/i };
  for (const [taxType, taxRegex] of Object.entries(sapTaxMap)) {
    for (let i = 0; i < lines.length; i++) {
      if (!taxRegex.test(lines[i])) continue;
      const sameLine = lines[i].match(/GST\s*([\d,]+(?:\.\d{1,2})?)\s*INR/i);
      if (sameLine) { const val = parseFloat(sameLine[1].replace(/,/g, "")); if (val >= 0) { taxes[taxType] = val; break; } }
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        const valMatch = lines[j].trim().match(/^([\d,]+(?:\.\d{1,2})?)\s*(?:INR)?/i);
        if (valMatch) { taxes[taxType] = parseFloat(valMatch[1].replace(/,/g, "")); break; }
      }
      break;
    }
  }

  // Line-by-line tax
  const lineTaxMap = { cgst: /C\.?\s*GST/i, sgst: /S\.?\s*GST/i, igst: /I\.?\s*GST/i };
  for (const [taxType, taxRegex] of Object.entries(lineTaxMap)) {
    if (taxes[taxType] !== null) continue;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const taxLabelMatch = line.match(new RegExp(taxRegex.source + '\\s+\\d+(?:\\.\\d+)?\\s*%\\s*([\\d,]*(?:\\.\\d{1,2})?)', 'i'));
      if (!taxLabelMatch) continue;
      const nums = [];
      const concatNum = taxLabelMatch[1];
      if (concatNum && concatNum.length > 0) nums.push(parseFloat(concatNum.replace(/,/g, "")));
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const trimmed = lines[j].trim();
        if (/^[\d,]+(?:\.\d{1,2})?$/.test(trimmed)) nums.push(parseFloat(trimmed.replace(/,/g, "")));
        else break;
      }
      if (nums.length >= 2) {
        const sorted = [...nums].sort((a, b) => a - b);
        if (sorted[0] > 0) { taxes[taxType] = sorted[0]; break; }
      } else if (nums.length === 1 && nums[0] > 0) { taxes[taxType] = nums[0]; break; }
    }
  }

  // Regex-based inline
  // "LABEL<rate> (<rate>%)<amount>" â the rate is glued directly onto the
  // label with no separator, e.g. "IGST18 (18%)86,400.00". Must be tried
  // before the generic catch-all below, which would otherwise mistake the
  // glued-on rate ("18") for the tax amount.
  const taxPatterns = {
    cgst: [/C\.?\s*GST\s*\d{1,2}(?:\.\d+)?\s*\(\s*\d{1,2}(?:\.\d+)?\s*%\s*\)\s*(?:â¹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/i, /C\.?\s*GST\s*(?:\(\s*\d+(?:\.\d+)?\s*%?\s*\))?\s*[-â:]\s*(?:â¹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/i, /C\.?\s*GST\s*[@\s]\s*\d+(?:\.\d+)?\s*%?[ \t]*[-â:]?[ \t]*(?:â¹|Rs\.?|INR)?[ \t]*([\d,]+(?:\.\d{1,2})?)/i, /(?:add\.?\s*)?C\.?\s*GST(?:\s*(?:Output|Input|Tax))?\s*[\s.:_\-]*(?:â¹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/i],
    sgst: [/S\.?\s*GST\s*\d{1,2}(?:\.\d+)?\s*\(\s*\d{1,2}(?:\.\d+)?\s*%\s*\)\s*(?:â¹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/i, /S\.?\s*GST\s*(?:\(\s*\d+(?:\.\d+)?\s*%?\s*\))?\s*[-â:]\s*(?:â¹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/i, /S\.?\s*GST\s*[@\s]\s*\d+(?:\.\d+)?\s*%?[ \t]*[-â:]?[ \t]*(?:â¹|Rs\.?|INR)?[ \t]*([\d,]+(?:\.\d{1,2})?)/i, /(?:add\.?\s*)?S\.?\s*GST(?:\s*(?:Output|Input|Tax))?\s*[\s.:_\-]*(?:â¹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/i],
    igst: [/I\.?\s*GST\s*\d{1,2}(?:\.\d+)?\s*\(\s*\d{1,2}(?:\.\d+)?\s*%\s*\)\s*(?:â¹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/i, /I\.?\s*GST\s*(?:\(\s*\d+(?:\.\d+)?\s*%?\s*\))?\s*[-â:]\s*(?:â¹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/i, /I\.?\s*GST\s*[@\s]\s*\d+(?:\.\d+)?\s*%?[ \t]*[-â:]?[ \t]*(?:â¹|Rs\.?|INR)?[ \t]*([\d,]+(?:\.\d{1,2})?)/i, /(?:add\.?\s*)?I\.?\s*GST(?:\s*(?:Output|Input|Tax))?\s*[\s.:_\-]*(?:â¹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/i],
  };
  for (const [taxType, patterns] of Object.entries(taxPatterns)) {
    if (taxes[taxType] !== null) continue;
    for (const pat of patterns) {
      const m = text.match(pat);
      if (m) { const val = parseAmount(m[1]); if (val !== null && val > 0) { taxes[taxType] = val; break; } }
    }
  }

  // Label-on-one-line, value-on-next
  const labelValuePairs = {};
  for (let i = 0; i < lines.length; i++) {
    if (/[.:]\s*$/.test(lines[i])) {
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        if (/^[\d,]+(?:\.\d{1,2})?$/.test(lines[j].trim())) {
          labelValuePairs[lines[i].toLowerCase().replace(/[.:_\-\s]+$/g, "").trim()] = parseFloat(lines[j].trim().replace(/,/g, ""));
          break;
        }
      }
    }
  }
  if (taxes.cgst === null) { const v = labelValuePairs["add cgst"] || labelValuePairs["cgst"] || labelValuePairs["cgst output"] || labelValuePairs["cgst  output"]; if (v > 0) taxes.cgst = v; }
  if (taxes.sgst === null) { const v = labelValuePairs["add sgst"] || labelValuePairs["sgst"] || labelValuePairs["sgst output"] || labelValuePairs["sgst  output"]; if (v > 0) taxes.sgst = v; }
  if (taxes.igst === null) { const v = labelValuePairs["add igst"] || labelValuePairs["igst"] || labelValuePairs["igst output"] || labelValuePairs["igst  output"]; if (v > 0) taxes.igst = v; }

  // Tally "Taxable Value / CGST% AMT / SGST% AMT / NET% AMT" summary table:
  // a header row followed by a numeric row of 7 values (taxable value, CGST
  // rate, CGST amount, SGST rate, SGST amount, NET rate, NET/total tax amount).
  if (taxes.cgst === null && taxes.sgst === null) {
    for (let i = 0; i < lines.length; i++) {
      if (!/^TaxableValueCGST%AMTSGST%AMTNET%AMT$/i.test(lines[i].replace(/\s+/g, ""))) continue;
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        const nums = lines[j].match(/[\d,]+\.\d{2}/g);
        if (nums && nums.length === 7) {
          const vals = nums.map((n) => parseFloat(n.replace(/,/g, "")));
          taxes.cgst = vals[2];
          taxes.sgst = vals[4];
          taxes.totalTax = vals[6];
          break;
        }
      }
      if (taxes.totalTax !== null) break;
    }
  }

  // Intra-state invoices always split GST evenly into CGST + SGST. If OCR
  // garbled one label badly enough that only the other was found (and no
  // IGST is present, so this isn't an inter-state invoice), mirror the value.
  if (taxes.igst === null) {
    if (taxes.cgst !== null && taxes.sgst === null) taxes.sgst = taxes.cgst;
    else if (taxes.sgst !== null && taxes.cgst === null) taxes.cgst = taxes.sgst;
  }

  // Total tax: prefer summing the already-extracted CGST/SGST/IGST amounts.
  // The label patterns below ("Tax Amount", "Total Tax", ...) can match
  // across a line break onto an unrelated column (e.g. a "Taxable Value"
  // figure printed on the next line), so a direct sum of the per-tax-type
  // amounts is more reliable whenever those were found.
  if (taxes.totalTax === null) {
    const parts = [taxes.cgst, taxes.sgst, taxes.igst].filter(v => v !== null && v > 0);
    if (parts.length > 0) taxes.totalTax = Math.round(parts.reduce((a, b) => a + b, 0) * 100) / 100;
  }
  if (taxes.totalTax === null) {
    const totalGstPatterns = [
      /total\s*(?:gst|tax)[\s.:_\-]*(?:â¹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/i,
      /tax\s*amount[\s.:_\-]*(?:â¹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/i,
      /total\s*tax\s*[.:_\-]?\s*(?:â¹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/i,
      /total\s*amount\s*[.:_\-]?\s*gst\s*[.:_\-]?\s*(?:â¹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    ];
    for (const pat of totalGstPatterns) {
      const m = text.match(pat);
      if (m) { taxes.totalTax = parseAmount(m[1]); break; }
    }
  }

  // Value-before-label: "CGST+SGST" / "Total Tax" / "Total GST" label on its own
  // line, with the amount printed 1-3 lines ABOVE it (jumbled SAP/Canon layout).
  if (taxes.totalTax === null) {
    for (let i = 0; i < lines.length; i++) {
      if (!/^(?:CGST\s*\+\s*SGST|Total\s*(?:GST|Tax))\s*$/i.test(lines[i].trim())) continue;
      for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
        const t = lines[j].trim().replace(/,/g, "");
        if (/^[\d.]+$/.test(t)) {
          const v = parseFloat(t);
          if (v > 0) { taxes.totalTax = v; break; }
        }
      }
      if (taxes.totalTax !== null) break;
    }
  }

  return taxes;
}

// âââ Totals Extraction âââââââââââââââââââââââââââââââââââââââââââââââââââââââ

function extractTotals(text, lines, taxes, items, currency) {
  const totals = {
    total_value: null,
    total_tax: taxes.totalTax,
    grand_total: null,
    currency,
    rounding: null,
    remarks: null,
  };

  // "Amount Chargeable (in words)" â its numeric counterpart (the invoice
  // grand total) is printed on the line immediately before this label.
  if (!totals.grand_total) {
    const acwIdx = lines.findIndex((l) => /amount\s*chargeable\s*\(?\s*in\s*words\s*\)?/i.test(l));
    if (acwIdx > 0) {
      const m = lines[acwIdx - 1].trim().match(/^([\d,]+\.\d{2})$/);
      if (m) totals.grand_total = parseAmount(m[1]);
    }
  }

  // SAP PO Total formats
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const totalInclMatch = line.match(/([\d,]+(?:\.\d{1,2})?)\s*INR\s*(?:Total\s*Value)?/i);
    if (totalInclMatch) {
      const nextLine = (i + 1 < lines.length) ? lines[i + 1].trim() : "";
      const nextNext = (i + 2 < lines.length) ? lines[i + 2].trim() : "";
      if (/^Total\s*Value\s*$/i.test(nextLine) && /^Including\s*Tax/i.test(nextNext)) {
        const val = parseFloat(totalInclMatch[1].replace(/,/g, ""));
        if (val > 0 && !totals.grand_total) totals.grand_total = val;
      } else if (/Including\s*Tax/i.test(line) || /Including\s*Tax/i.test(nextLine)) {
        const val = parseFloat(totalInclMatch[1].replace(/,/g, ""));
        if (val > 0 && !totals.grand_total) totals.grand_total = val;
      }
      if (/^Total\s*Tax/i.test(nextLine)) {
        const val = parseFloat(totalInclMatch[1].replace(/,/g, ""));
        if (val >= 0 && totals.total_tax === null) totals.total_tax = val;
      }
      if (/^Total\s*Value\s*:/i.test(nextLine) && !/Including/i.test(nextNext)) {
        const val = parseFloat(totalInclMatch[1].replace(/,/g, ""));
        if (val > 0 && !totals.total_value) totals.total_value = val;
      }
    }
  }

  // Tally-style "Total <qty> <taxable_value> <grand_total>" summary row
  // (e.g. "Total    40.000 12800.00  15104.00") â gives both the pre-tax
  // taxable value and the tax-inclusive grand total in one line. Resolved
  // ahead of "Sub Total" / "Net Amount" below, since in this template "Net
  // Amount" labels the tax-inclusive grand total, not the pre-tax subtotal.
  if (!totals.total_value || !totals.grand_total) {
    for (const line of lines) {
      const m = line.match(/^Total\s+([\d,]+(?:\.\d{1,3})?)\s+([\d,]+(?:\.\d{1,2})?)\s+([\d,]+(?:\.\d{1,2})?)$/i);
      if (!m) continue;
      const taxableValue = parseAmount(m[2]);
      const grand = parseAmount(m[3]);
      if (taxableValue > 0 && grand > taxableValue) {
        if (!totals.total_value) totals.total_value = taxableValue;
        if (!totals.grand_total) totals.grand_total = grand;
        break;
      }
    }
  }

  // Sub Total / Net Amount
  const subTotalPatterns = [
    /sub[\s\-]*total[\s.:_\-]*(?:â¹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /total\s*amount\s*before\s*tax[\s.:_\-]*(?:â¹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /net\s*amount[\s.:_\-]*(?:â¹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /total\s*value\s*[:\-]?\s*(?:â¹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /taxable\s*(?:amount|value)[\s.:_\-]*(?:â¹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/i,
  ];
  for (const pat of subTotalPatterns) {
    const m = text.match(pat);
    if (m && !totals.total_value) { totals.total_value = parseAmount(m[1]); break; }
  }

  // Grand total
  const grandTotalSection = text.match(/grand\s*total[\s\S]{0,100}/i);
  if (grandTotalSection) {
    const section = grandTotalSection[0];
    const allAmts = [];
    const amtScan = /(?:â¹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/g;
    let scan;
    while ((scan = amtScan.exec(section)) !== null) { const v = parseAmount(scan[1]); if (v) allAmts.push(v); }
    const plainAmtScan = /\b([\d,]+\.\d{2})\b/g;
    while ((scan = plainAmtScan.exec(section)) !== null) { const v = parseAmount(scan[1]); if (v && !allAmts.includes(v)) allAmts.push(v); }
    if (allAmts.length > 0 && !totals.grand_total) totals.grand_total = Math.max(...allAmts);
  }

  if (!totals.grand_total) {
    const totalPatterns = [
      /total\s*amount\s*after\s*tax[\s.:_\-]*(?:â¹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/i,
      /total\s*(?:amount|payable|due|invoice\s*amount)[\s.:_\-]*(?:â¹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/i,
      /total\s*value\s*(?:including|incl\.?)\s*tax[\s.:_\-]*(?:â¹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/i,
      /(?<![Ss]ub\s)\bTOTAL\s*(?:â¹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)\s*$/im,
      /payment\s*amount[\s.:_\-]*(?:â¹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    ];
    for (const pat of totalPatterns) {
      const m = text.match(pat);
      if (m) { totals.grand_total = parseAmount(m[1]); break; }
    }
  }

  // "Total" with or without currency symbol: pick the LARGEST amount from any
  // "Total" line, as smaller "Total" values are often quantity totals (e.g. "Total
  // 30000" for qty).  Excludes "Sub Total" which is the pre-tax subtotal.
  if (!totals.grand_total) {
    const totalLineRegex = /(?<![Ss]ub\s)\bTOTAL\s*(?:[â¹$â¬Â£]|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)\s*$/gim;
    let tmatch;
    let bestTotal = 0;
    while ((tmatch = totalLineRegex.exec(text)) !== null) {
      const val = parseAmount(tmatch[1]);
      if (val > bestTotal) bestTotal = val;
    }
    if (bestTotal > 0) totals.grand_total = bestTotal;
  }

  if (!totals.grand_total) {
    const lastLines = lines.slice(-15);
    let maxAmt = 0;
    for (const line of lastLines) {
      if (/total|grand|amount|payable/i.test(line)) {
        const nums = line.match(/(?:â¹\s*)?([\d,]+(?:\.\d{1,2})?)/g);
        if (nums) { for (const n of nums) { const val = parseFloat(n.replace(/[â¹,\s]/g, "")); if (val > maxAmt) maxAmt = val; } }
      }
    }
    if (maxAmt > 0) totals.grand_total = maxAmt;
  }

  // Derive total_value from items if missing
  if (!totals.total_value && items.length > 0) {
    const netSum = items.reduce((s, it) => s + (it.net_value || 0), 0);
    if (netSum > 0) totals.total_value = Math.round(netSum * 100) / 100;
  }

  // Derive grand_total from total_value + total_tax
  if (!totals.grand_total && totals.total_value && totals.total_tax !== null) {
    totals.grand_total = Math.round((totals.total_value + totals.total_tax) * 100) / 100;
  }

  // Derive total_tax from grand_total - total_value when the tax amount
  // couldn't be read directly off the page (e.g. CGST/SGST split across an
  // OCR-jumbled summary table).
  if (totals.total_tax === null && totals.total_value && totals.grand_total && totals.grand_total > totals.total_value) {
    totals.total_tax = Math.round((totals.grand_total - totals.total_value) * 100) / 100;
  }

  // Rounding â also covers "Round Off" / "Round(Off)" / "Rounding Off" labels.
  // Note: the separator class deliberately excludes "-" so a negative amount's
  // sign isn't swallowed by the label separator. The value itself may be
  // "(-)0.04" / "(+)0.04" (sign in its own parens) or "(0.04)" (accounting
  // notation for negative) â handled by parseRoundingAmount.
  const ROUNDING_VALUE = "\\(\\s*[-+]\\s*\\)\\s*[\\d,]*\\.?\\d+|\\([\\d,]*\\.?\\d+\\)|[-+]?[\\d,]*\\.?\\d+";
  const roundingRe = new RegExp(`round(?:ed|ing)?\\s*(?:-|\\(|\\s)*off\\)?[\\s.:_]*(?:â¹|Rs\\.?|INR)?\\s*(${ROUNDING_VALUE})|rounding[\\s.:_\\-]*(?:â¹|Rs\\.?|INR)?\\s*(${ROUNDING_VALUE})`, "i");
  const roundingMatch = text.match(roundingRe);
  if (roundingMatch) totals.rounding = parseRoundingAmount(roundingMatch[1] || roundingMatch[2]);

  // Remarks / Notes / Comments / Narration â free-text field, take rest of line
  const remarksMatch = text.match(/(?:remarks?|notes?|comments?|narration|special\s*instructions?)\s*[:\-]\s*([^\n]+)/i);
  if (remarksMatch) {
    const val = remarksMatch[1].trim();
    if (val && !/^(N\/?A|NIL|-)$/i.test(val)) totals.remarks = val;
  }

  return totals;
}

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// MAIN: parseInvoiceData
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

function parseInvoiceData(rawText) {
  const text = rawText.replace(/\t+/g, " ");
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const rawLines = rawText.split("\n").map(l => l.trim()).filter(Boolean);

  const currency = detectCurrency(text);
  const { seller, buyer, consignee } = extractParties(text, lines);
  const invoice_details = extractInvoiceDetails(text, lines);
  let items = extractLineItems(text, lines, rawLines, currency, seller.name);
  const taxes = extractTaxes(text, lines);
  let totals = extractTotals(text, lines, taxes, items, currency);

  // Remove phantom summary/totals rows mis-parsed as line items, then recompute
  // totals so item-derived fields (total_value) don't include the dropped ghost.
  const pruned = dropSummaryRows(items, totals);
  if (pruned.length !== items.length) {
    items = pruned;
    for (let i = 0; i < items.length; i++) items[i].item_no = i + 1;
    totals = extractTotals(text, lines, taxes, items, currency);
  }

  // Distribute invoice-level taxes to line items when per-item taxes are all null/0
  if (taxes.totalTax > 0) {
    const allItemTaxNull = items.every(it => !it.tax_amount);
    if (allItemTaxNull && items.length > 0) {
      const totalNet = items.reduce((s, it) => s + (it.net_value || 0), 0);
      for (const item of items) {
        const ratio = totalNet > 0 ? (item.net_value || 0) / totalNet : (1 / items.length);
        item.tax_amount = Math.round((taxes.totalTax) * ratio * 100) / 100;
      }
    }
  }

  return {
    purchase_order: extractPurchaseOrder(text, lines),
    invoice_number: extractInvoiceNumber(text, lines),
    seller,
    buyer,
    consignee,
    invoice_details,
    items,
    totals,
    rawText,
  };
}

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// MAIN: parseCreditNoteData
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

function parseCreditNoteData(rawText) {
  const text = rawText.replace(/\t+/g, " ");
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const rawLines = rawText.split("\n").map(l => l.trim()).filter(Boolean);

  const currency = detectCurrency(text);

  // Credit note number
  let creditNo = null;

  // 1) Label-on-one-line, value-on-next-line (most reliable for multi-line PDFs)
  for (let i = 0; i < lines.length && !creditNo; i++) {
    if (/credit\s*(?:note|memo)\s*(?:no|number|#)\.?\s*[.:_\-]?\s*$/i.test(lines[i])) {
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const candidate = lines[j].trim();
        if (/^[A-Z0-9][A-Z0-9\-\/]*$/i.test(candidate) && candidate.length >= 2 && !/^(date|purchase|ref|supplier|gstin|item|qty)/i.test(candidate)) {
          creditNo = candidate;
          break;
        }
      }
    }
  }

  // 2) Inline patterns (label + value on same line)
  if (!creditNo) {
    const creditNoPatterns = [
      /credit\s*(?:note|memo)\s*(?:no|number|#)\.?\s*[.:_\-]?\s*([A-Z0-9][A-Z0-9\-\/]+)/i,
      /(?:CN|credit)\s*[.:_\-]\s*([A-Z0-9][A-Z0-9\-\/]+)/i,
    ];
    for (const pat of creditNoPatterns) {
      const m = text.match(pat);
      if (m && m[1].length >= 2) {
        const val = m[1].trim();
        if (!/^(date|note|memo|no|number|purchase|ref|supplier|gstin|item|type)$/i.test(val)) {
          creditNo = val;
          break;
        }
      }
    }
  }

  // SAP stacked label/value format: labels block then values block
  // "Credit Memo No:\nDate:\nPurchase Order:\n...\n1045\n13-Jan-26\n4500000250\n..."
  const stackedFields = {};
  for (let i = 0; i < lines.length; i++) {
    if (/^Credit\s*(?:Memo|Note)\s*No\s*[.:_\-]?\s*$/i.test(lines[i])) {
      // Count consecutive label lines (ending with ":")
      const labels = [];
      for (let j = i; j < Math.min(i + 10, lines.length); j++) {
        if (/:\s*$/.test(lines[j]) && /[A-Za-z]{2,}/.test(lines[j])) {
          labels.push(lines[j].replace(/\s*:\s*$/, "").trim().toLowerCase());
        } else break;
      }
      // Collect same number of value lines
      const valStart = i + labels.length;
      for (let k = 0; k < labels.length && valStart + k < lines.length; k++) {
        stackedFields[labels[k]] = lines[valStart + k].trim();
      }
      break;
    }
  }

  // Use stacked fields if available
  if (!creditNo && stackedFields["credit memo no"]) creditNo = stackedFields["credit memo no"];
  if (!creditNo && stackedFields["credit note no"]) creditNo = stackedFields["credit note no"];

  // Document ID / Invoice reference
  let documentId = stackedFields["ref invoice"] || null;
  if (!documentId) {
    const docIdMatch = text.match(/(?:document|doc|ref\s*invoice)\s*(?:id|no|number)?\s*[.:_\-]?\s*([A-Z0-9][A-Z0-9\-\/]+)/i);
    documentId = docIdMatch ? docIdMatch[1].trim() : null;
  }

  // PO
  let purchaseOrder = stackedFields["purchase order"] || null;
  if (!purchaseOrder || !/^\d{6,}$/.test(purchaseOrder)) {
    purchaseOrder = extractPurchaseOrder(text, lines) || purchaseOrder;
  }

  // Date
  const details = extractInvoiceDetails(text, lines);
  const creditNoteDate = details.invoice_date;

  // Items (reuse line item extraction)
  const items = extractLineItems(text, lines, rawLines, currency);
  const taxes = extractTaxes(text, lines);
  const totals = extractTotals(text, lines, taxes, items, currency);

  // Map items to credit note format
  const _CREDITI = items.map(item => ({
    Purchseorder: fmt(purchaseOrder),
    CreditNo: fmt(creditNo),
    Lineitem: fmt(item.item_no),
    MaterialDoc: fmt(item.description),
    CreditUom: fmt(item.unit),
    CreditQuantity: fmt(item.quantity),
    CreditCurrency: fmt(item.currency || currency),
    CreditUnitprice: fmt(item.unit_price),
    CreditNetAmt: fmt(item.net_value),
    CreditHsn: fmt(item.hsn_code),
    CreditTaxAmt: fmt(item.tax_amount),
  }));

  return {
    Purchseorder: fmt(purchaseOrder),
    CreditNo: fmt(creditNo),
    DocumentId: fmt(documentId),
    CreditTotalValue: fmt(totals.grand_total),
    CreditTotalNetAmt: fmt(totals.total_value),
    CreditApproved: null,
    CreditRejected: null,
    CreditNoteDate: fmt(creditNoteDate),
    CreditStatus: null,
    _CREDITI,
    rawText,
  };
}

module.exports = { parseInvoiceData, parseCreditNoteData };
