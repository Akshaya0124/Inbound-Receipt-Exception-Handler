/**
 * Document field parsers — ported from the client-side ExtractionService (v3.2).
 *
 * The OCR/preprocessing pipeline of that service is browser-only; only the
 * deterministic text parsers are ported here. They run on the rawText that the
 * backend OCR (tesseract / pdf) already produces. Output keys are mapped to the
 * backend's camelCase field names (and rawText is attached) so the CAP typed
 * results and UI stay consistent.
 */

function _clean(s) {
  return (s || "")
    .replace(/[–—]/g, "-")
    .replace(/[''""]/g, "'")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

// Indian states/UTs — used to validate/recover State from address text.
var _GST_STATES = ["Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chhattisgarh","Goa","Gujarat","Haryana","Himachal Pradesh","Jharkhand","Karnataka","Kerala","Madhya Pradesh","Maharashtra","Manipur","Meghalaya","Mizoram","Nagaland","Odisha","Orissa","Punjab","Rajasthan","Sikkim","Tamil Nadu","Telangana","Tripura","Uttar Pradesh","Uttarakhand","West Bengal","Delhi","Jammu and Kashmir","Ladakh","Chandigarh","Puducherry","Andaman and Nicobar Islands","Dadra and Nagar Haveli","Daman and Diu","Lakshadweep"];

// Pre-compiled state regexes for efficient matching
var _STATE_REGEXES = _GST_STATES.map(function (s) {
  return { name: s, re: new RegExp("\\b" + s.replace(/\s+/g, "\\s+") + "\\b", "i") };
});

function matchIndianState(text) {
  if (!text) return null;
  for (var i = 0; i < _STATE_REGEXES.length; i++) {
    if (_STATE_REGEXES[i].re.test(text)) return _STATE_REGEXES[i].name;
  }
  return null;
}

function isIndianState(v) {
  if (!v) return false;
  var n = v.replace(/\s+/g, " ").trim().toUpperCase();
  if (n.length < 3) return false;
  for (var i = 0; i < _GST_STATES.length; i++) {
    if (_GST_STATES[i].toUpperCase() === n) return true;
  }
  var collapsed = n.replace(/\s+/g, "");
  for (var j = 0; j < _GST_STATES.length; j++) {
    if (_GST_STATES[j].toUpperCase().replace(/\s+/g, "") === collapsed) return true;
  }
  return false;
}

// IFSC bank prefix lookup
var _BANK_NAMES = {
  "SBIN":"State Bank of India","HDFC":"HDFC Bank","ICIC":"ICICI Bank","UTIB":"Axis Bank","PUNB":"Punjab National Bank",
  "CNRB":"Canara Bank","UBIN":"Union Bank of India","IOBA":"Indian Overseas Bank","BARB":"Bank of Baroda",
  "BKID":"Bank of India","IDIB":"Indian Bank","KKBK":"Kotak Mahindra Bank","INDB":"IndusInd Bank",
  "YESB":"Yes Bank","FDRL":"Federal Bank","CBIN":"Central Bank of India","MAHB":"Bank of Maharashtra",
  "ALLA":"Allahabad Bank","ANDB":"Andhra Bank","CORP":"Corporation Bank","SYNB":"Syndicate Bank",
  "UCBA":"UCO Bank","VIJB":"Vijaya Bank","ORBC":"Oriental Bank of Commerce","PSIB":"Punjab & Sind Bank",
  "SIBL":"South Indian Bank","KARB":"Karnataka Bank","TMBL":"Tamilnad Mercantile Bank","KVBL":"Karur Vysya Bank",
  "CIUB":"City Union Bank","DLXB":"Dhanlaxmi Bank","CSBK":"CSB Bank","NTBL":"Nainital Bank",
  "CITI":"Citibank","SCBL":"Standard Chartered","HSBC":"HSBC","DEUT":"Deutsche Bank",
  "DBSS":"DBS Bank","RATN":"RBL Bank","IDFB":"IDFC First Bank","BNPA":"BNP Paribas",
  "JAKA":"J&K Bank","BKDN":"Dena Bank","LAVB":"Lakshmi Vilas Bank","DCBL":"DCB Bank",
  "COSB":"Cosmos Bank","SVCB":"SVC Bank","NKGS":"NKGSB Bank","IBKL":"IDBI Bank",
  "AIRP":"Airtel Payments Bank","PYTM":"Paytm Payments Bank","JIOP":"Jio Payments Bank"
};

function bankNameFromIfsc(ifsc) {
  if (!ifsc || ifsc.length < 4) return null;
  return _BANK_NAMES[ifsc.substring(0, 4).toUpperCase()] || null;
}

// ─── PAN ──────────────────────────────────────────────────────────────────────
var _D2L = { "0": "O", "1": "I", "5": "S", "8": "B", "2": "Z", "6": "G", "7": "T" };
var _L2D = { "O": "0", "I": "1", "S": "5", "B": "8", "Z": "2", "G": "6", "T": "7", "L": "1", "Q": "0" };

function _fixPan(s) {
  if (s.length !== 10) { return null; }
  var out = "";
  for (var i = 0; i < 10; i++) {
    var c = s[i], lt = (i < 5 || i === 9);
    if (lt) {
      if (/[A-Z]/.test(c)) { out += c; }
      else if (_D2L[c]) { out += _D2L[c]; }
      else { return null; }
    } else {
      if (/[0-9]/.test(c)) { out += c; }
      else if (_L2D[c]) { out += _L2D[c]; }
      else { return null; }
    }
  }
  return /^[A-Z]{5}\d{4}[A-Z]$/.test(out) ? out : null;
}

function parsePANData(rawText) {
  var t = _clean(rawText);
  var u = t.toUpperCase(), r = { PAN: null, Name: null };

  var cp0 = u.replace(/[^A-Z0-9]/g, "");
  var anchorList = ["PERMANENTACCOUNTNUMBER", "FERMANENTACCOUNTNUMBER", "PERMANENTACCOUNT", "ACCOUNTNUMBER"];
  var aEnd = -1;
  for (var aj = 0; aj < anchorList.length; aj++) { var ap = cp0.indexOf(anchorList[aj]); if (ap >= 0) { aEnd = ap + anchorList[aj].length; break; } }
  if (aEnd >= 0) {
    var seg0 = cp0.slice(aEnd, aEnd + 24);
    for (var sk = 0; sk <= seg0.length - 10; sk++) { var sf = _fixPan(seg0.substr(sk, 10)); if (sf) { r.PAN = sf; break; } }
  }

  if (!r.PAN) {
    var ex = u.match(/\b[A-Z]{5}\d{4}[A-Z]\b/g) || [];
    if (ex.length) {
      var exCounts = {};
      for (var ei = 0; ei < ex.length; ei++) { exCounts[ex[ei]] = (exCounts[ex[ei]] || 0) + 1; }
      var bestEx = ex[0], bestExCount = exCounts[ex[0]];
      Object.keys(exCounts).forEach(function (pan) {
        if (exCounts[pan] > bestExCount) { bestEx = pan; bestExCount = exCounts[pan]; }
      });
      r.PAN = bestEx;
    }
  }

  if (!r.PAN) {
    var toks = u.match(/[A-Z0-9]{8,12}/g) || [];
    var panCounts = {};
    for (var ti = 0; ti < toks.length; ti++) {
      var tok = toks[ti];
      for (var k = 0; k <= tok.length - 10; k++) {
        var f = _fixPan(tok.substr(k, 10));
        if (f) { panCounts[f] = (panCounts[f] || 0) + 1; break; }
      }
    }
    var bestPan = null, bestCount = 0;
    Object.keys(panCounts).forEach(function (pan) {
      if (panCounts[pan] > bestCount) { bestPan = pan; bestCount = panCounts[pan]; }
    });
    if (bestPan) { r.PAN = bestPan; }
  }

  if (!r.PAN) {
    var cp = u.replace(/[^A-Z0-9]/g, "");
    var anchorEnd = -1;
    var anchors = ["PERMANENTACCOUNTNUMBER", "FERMANENTACCOUNTNUMBER", "PERMANENTACCOUNT", "ACCOUNTNUMBER"];
    for (var ai = 0; ai < anchors.length; ai++) { var ai2 = cp.indexOf(anchors[ai]); if (ai2 >= 0) { anchorEnd = ai2 + anchors[ai].length; break; } }
    var cands = [];
    for (var k2 = 0; k2 <= cp.length - 10; k2++) { var f2 = _fixPan(cp.substr(k2, 10)); if (f2) { cands.push([k2, f2]); } }
    if (cands.length) {
      if (anchorEnd >= 0) {
        var after = cands.filter(function (c) { return c[0] >= anchorEnd; });
        if (after.length) { r.PAN = after[0][1]; }
      }
      if (!r.PAN) { r.PAN = cands[0][1]; }
    }
  }

  var lines = t.split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
  for (var li = 0; li < lines.length; li++) {
    var l = lines[li];
    if (l.length < 4 || l.length > 60) { continue; }
    if (!/^[A-Z][A-Za-z\s\.]{3,59}$/.test(l)) { continue; }
    var alphaWords = l.split(/[\s\.]+/).filter(function (w) { return /^[A-Za-z]+$/.test(w); });
    if (alphaWords.length < 2) { continue; }
    if (!alphaWords.some(function (w) { return w.length >= 4; })) { continue; }
    if (/INCOME|TAX|DEPT|DEPARTMENT|GOVT|INDIA|PERMANENT|ACCOUNT|NUMBER|SIGNATURE|DIVISION|AAYKAR|VIBHAG|BHARAT|SARKAR|FATHER/i.test(l)) { continue; }
    r.Name = l; break;
  }

  var dob = t.match(/(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/);
  var validDob = null;
  if (dob) {
    var parts = dob[1].split(/[\/\-.]/);
    var dd = parseInt(parts[0], 10), mm = parseInt(parts[1], 10), yyyy = parseInt(parts[2], 10);
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12 && yyyy >= 1900 && yyyy <= 2100) {
      validDob = dob[1];
    }
  }

  var fatherName = null;
  var fm = t.match(/father.?s?\s*name\s*[:\-]?\s*\n?\s*([A-Z][A-Za-z\s\.]{3,40})/i);
  if (fm) { fatherName = fm[1].trim(); }

  return {
    panNumber: r.PAN,
    name: r.Name,
    fatherName: fatherName,
    dateOfBirth: validDob,
    rawText: rawText,
  };
}

// ─── GST ──────────────────────────────────────────────────────────────────────
function _gstChk(s) {
  var C = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ", F = [1,2,1,2,1,2,1,2,1,2,1,2,1,2], sum = 0;
  for (var i = 0; i < 14; i++) { var cp = C.indexOf(s[i]); if (cp < 0) { return false; } var p = cp * F[i]; sum += Math.floor(p / 36) + (p % 36); }
  return C[(36 - (sum % 36)) % 36] === s[14];
}

function _gstFix(cand) {
  if (cand.length !== 15) { return null; }
  var L2D = { "O": "0", "I": "1", "S": "5", "B": "8", "Z": "2", "G": "6", "T": "7", "L": "1", "Q": "0", "D": "0" };
  var D2L = { "0": "O", "1": "I", "5": "S", "8": "B", "2": "Z", "6": "G", "7": "T", "4": "A" };
  var out = "";
  for (var p = 0; p < 15; p++) {
    var c = cand[p];
    if (p < 2 || (p >= 7 && p <= 10)) {
      if (/\d/.test(c)) { out += c; } else if (L2D[c]) { out += L2D[c]; } else { return null; }
    } else if ((p >= 2 && p <= 6) || p === 11) {
      if (/[A-Z]/.test(c)) { out += c; } else if (D2L[c]) { out += D2L[c]; } else { return null; }
    } else if (p === 13) {
      out += "Z";
    } else {
      out += c;
    }
  }
  return out;
}

function _scanGstin(sc) {
  var L2D = { "O": "0", "I": "1", "S": "5", "B": "8", "Z": "2", "G": "6", "T": "7", "L": "1", "Q": "0", "D": "0" };
  var D2L = { "0": "O", "1": "I", "5": "S", "8": "B", "2": "Z", "6": "G", "7": "T", "4": "A" };
  var strict = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
  for (var gi = 0; gi <= sc.length - 15; gi++) {
    var cand = sc.substr(gi, 15);
    if (!/^[A-Z0-9]{15}$/.test(cand)) { continue; }
    var fix = _gstFix(cand);
    if (!fix) { continue; }
    var tries = [fix];
    if (D2L[fix[14]]) { tries.push(fix.substring(0, 14) + D2L[fix[14]]); }
    if (L2D[fix[14]]) { tries.push(fix.substring(0, 14) + L2D[fix[14]]); }
    if (D2L[fix[12]]) { tries.push(fix.substring(0, 12) + D2L[fix[12]] + fix.substring(13)); }
    if (L2D[fix[12]]) { tries.push(fix.substring(0, 12) + L2D[fix[12]] + fix.substring(13)); }
    for (var ti = 0; ti < tries.length; ti++) {
      var v = tries[ti];
      if (strict.test(v) && _gstChk(v)) { return v; }
    }
  }
  return null;
}

function parseGSTData(rawText) {
  var t = _clean(rawText);
  var u = t.toUpperCase(), sc = u.replace(/\s+/g, ""), r = { GSTIN: null, "Legal Name": null, Address: null, State: null, District: null, Pincode: null };

  var labelM = u.match(/G\s*S\s*T\s*[I1L]\s*N/);
  if (labelM) {
    var seg = u.slice(labelM.index + labelM[0].length).replace(/[^A-Z0-9]/g, "").slice(0, 40);
    r.GSTIN = _scanGstin(seg);
  } else {
    r.GSTIN = _scanGstin(sc);
  }

  var nm = t.match(/legal\s*name(?:\s*of\s*(?:the\s*)?business)?[ \t]*[:\-|]?[ \t]*([^\n]+)/i);
  if (nm) {
    var lnVal = nm[1].trim().replace(/\s*trade\s*name.*$/i, "").trim();
    if (lnVal.length >= 3) { r["Legal Name"] = lnVal.substring(0, 80); }
  }
  if (!r["Legal Name"]) {
    var lines = t.split("\n").map(function (l) { return l.trim(); });
    for (var li = 0; li < lines.length; li++) {
      if (!/^(?:\d+\.?\s*\|?\s*)?legal\s*name\b/i.test(lines[li])) { continue; }
      for (var lj = li + 1; lj < lines.length; lj++) {
        var nx = lines[lj];
        if (!nx) { continue; }
        if (/^(trade\s*name|constitution|address|date\s*of|period\s*of|type\s*of|particulars|signature|name\s*$|designation|jurisdic|gstin|legal\s*name)/i.test(nx)) { continue; }
        r["Legal Name"] = nx.replace(/\s*trade\s*name.*$/i, "").trim().substring(0, 80);
        break;
      }
      if (r["Legal Name"]) { break; }
    }
  }

  var tradeName = null;
  var tn = t.match(/trade\s*name(?:\s*,?\s*if\s*any)?[ \t]*[:\-|]?[ \t]*([^\n]+)/i);
  if (tn) {
    var tnVal = tn[1].trim();
    if (tnVal.length >= 2 && !/^[:\-|]/.test(tnVal)) { tradeName = tnVal.substring(0, 80); }
  }

  var addr = t.match(/(?:principal\s*place(?:\s*of\s*business)?|address(?:\s*of\s*principal)?)\s*[:\-]?\s*([\s\S]*?\d{6})/i);
  if (addr) {
    var a = addr[1].replace(/\n+/g, ", ").replace(/,\s*,/g, ",").replace(/\s+/g, " ").trim();
    a = a.replace(/^(?:place\s*of\s*business|place\s*of|of\s*business)\s*[,:\s]*/i, "");
    a = a.replace(/,\s*business\s+/gi, ", ");
    a = a.replace(/\s+/g, " ").replace(/,\s*,/g, ",").replace(/^[,\s]+/, "").trim();
    r.Address = a.substring(0, 200);
  }

  t.split("\n").forEach(function (ln) {
    if (!r.State) {
      var s = ln.match(/^state\s*[:\-]?\s*([A-Za-z][A-Za-z\s]{2,28})/i);
      if (s) { r.State = s[1].trim(); }
    }
  });
  if (!r.State && r.Address) {
    r.State = matchIndianState(r.Address);
  }

  var dist = t.match(/district\s*[:\-]?\s*([A-Za-z][A-Za-z\s]{2,28})/i);
  if (dist) { r.District = dist[1].trim(); }
  if (!r.District && r.Address && r.State) {
    var parts = r.Address.split(",").map(function (p) { return p.trim(); }).filter(Boolean);
    for (var pi = 0; pi < parts.length; pi++) {
      if (parts[pi].toLowerCase() === r.State.toLowerCase() && pi > 0) {
        var prev = parts[pi - 1].replace(/\d+/g, "").trim();
        if (prev) { r.District = prev; }
        break;
      }
    }
  }

  var pin = t.match(/(?:pin\s*code|pincode)\s*[:\-]?\s*(\d{6})/i) || t.match(/\b(\d{6})\b/);
  if (pin) { r.Pincode = pin[1]; }

  return {
    gstin: r.GSTIN,
    legalName: r["Legal Name"],
    tradeName: tradeName,
    address: r.Address,
    state: r.State,
    district: r.District,
    pincode: r.Pincode,
    rawText: rawText,
  };
}

// ─── MSME ─────────────────────────────────────────────────────────────────────
var _msmeIsState = isIndianState;

function _spaceMsmeLabels(s) {
  return (s || "")
    .replace(/(Village\s*\/\s*Town|Road\s*\/\s*Street(?:\s*\/\s*Lane)?|Name\s*of\s*Premises\s*\/\s*Building|Premises\s*\/\s*Building|Block|City|State|District|Mobile|Email)/gi, " $1 ")
    .replace(/[ \t]+/g, " ");
}

function parseMSMEData(rawText) {
  var t = _clean(rawText);
  var u = t.toUpperCase(), sc = u.replace(/\s+/g, "").replace(/-+/g, "-").replace(/UDVAM|UOYAM|UDAYAM/g, "UDYAM"),
    r = { MSME: null, "Enterprise Name": null, "Enterprise Type": null, "Registration Date": null,
          HouseNo: null, Building: null, "Village/Town": null, Block: null, "Road/Street": null, City: null,
          State: null, District: null, Pincode: null };

  var m = sc.match(/UDYAM-?[A-Z]{2}-?\d{2}-?\d{7}/);
  if (m) { var raw = m[0].replace(/-/g, ""); r.MSME = raw.length >= 16 ? "UDYAM-" + raw.substr(5, 2) + "-" + raw.substr(7, 2) + "-" + raw.substr(9) : m[0]; }
  if (!r.MSME) { var rm = t.match(/UDYAM[\s\-]*[A-Z]{2}[\s\-]*\d{2}[\s\-]*\d{7}/i); if (rm) { var d2 = rm[0].toUpperCase().replace(/[^A-Z0-9]/g, ""); if (d2.length >= 16) { r.MSME = "UDYAM-" + d2.substr(5, 2) + "-" + d2.substr(7, 2) + "-" + d2.substr(9); } } }

  var en = t.match(/(?:name\s*of\s*(?:the\s*)?enterprise|enterprise\s*name)[ \t]*\*?[ \t]*[:\-]?[ \t]*([^\n]+)/i);
  if (en) { r["Enterprise Name"] = en[1].trim().replace(/^\*\s*/, "").substring(0, 80); }

  var et = t.match(/type\s*of\s*enterprise\b[\s\S]{0,60}?\b(MICRO|SMALL|MEDIUM)(?![A-Za-z])/i);
  if (!et) { et = t.match(/20\d{2}\s*-\s*\d{2}\s*(MICRO|SMALL|MEDIUM)(?![A-Za-z])/i); }
  if (!et) { et = t.match(/(?:type|typ[eo])\s*(?:of|0f|gf)?\s*enterprise\b[\s\S]{0,120}?\b(MICRO|SMALL|MEDIUM)(?![A-Za-z])/i); }
  if (!et) { et = t.match(/\b(MICRO|SMALL|MEDIUM)\s*\(\s*Based\s+on\s+FY/i); }
  if (!et) { et = t.match(/^\s*\*?\s*(MICRO|SMALL|MEDIUM)\s*(?:\(|$)/im); }
  if (et) {
    r["Enterprise Type"] = et[1].toUpperCase();
  } else {
    var etLine = t.match(/(?:type\s*of\s*enterprise|major\s*activity)[ \t]*\*?[ \t]*[:\-]?[ \t]*([^\n]+)/i);
    if (etLine) {
      var etVal = etLine[1].trim().replace(/^\*\s*/, "").replace(/\s*\([^)]*\)\s*$/, "").trim();
      if (etVal) { r["Enterprise Type"] = etVal.substring(0, 60); }
    }
  }

  var dt = t.match(/(?:date\s*of\s*(?:udyam\s*)?registration|date\s*of\s*incorporation)\s*[:\-]?\s*(\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{2,4})/i);
  if (dt) { r["Registration Date"] = dt[1]; }

  var startRe = /\b(?:f)?lat\s*[/\\]?\s*door\s*[/\\]?\s*block|offic[ai]?[a-z]?\s*address\s*of|name\s*of\s*premises|village\s*[/\\]?\s*town|road\s*[/\\]?\s*street\s*[/\\]?\s*lane/i;
  var startM = t.match(startRe);
  var addrSrc;
  if (startM) {
    var startIdx = startM.index;
    var afterStart = t.substring(startIdx + 1);
    var aEnd = afterStart.search(/date\s*of\s*(?:incorporation|commencement|udyam|registration)|national\s*industry\s*classification|nic\s*\d+\s*digit|udyam\s*registration\s*(?:certificate|number)|major\s*activity|for\s*any\s*assistance|disclaimer\b/i);
    addrSrc = (aEnd >= 0) ? t.substring(startIdx, startIdx + 1 + aEnd) : t.substring(startIdx);
  } else { addrSrc = t; }
  var aN = _spaceMsmeLabels(addrSrc).replace(/\|/g, " ").replace(/\s+/g, " ").trim();

  function isBadAddrVal(s) {
    if (!s) { return true; }
    if (/offic[ai]?[a-z]?\s*address|\baddress\s*of\b|date\s*of\s*(?:incorporation|commencement|udyam|registration)|enterprise|registration\s*of|national\s*industry|tamil\s*nadu|\bpin\s*\d{6}|udyam\s*registration|classification/i.test(s)) { return true; }
    return false;
  }

  var STOP = "name\\s*of\\b|premises\\s*[/\\\\]|village\\s*[/\\\\]?\\s*town|road\\s*[/\\\\]?\\s*street|\\bcity\\b|\\bstate\\b|\\bdistrict\\b|\\bpin(?:code)?\\b|\\bmobile\\b|\\bemail\\b|enterprise\\b|date\\s*of\\s*(?:incorporation|commencement|udyam|registration)|national\\s*industry|offic[ai]?[a-z]?\\s*address|udyam\\s*registration";
  var END = "\\s*$";

  var hnLabelRe = /\b(?:f)?lat\s*[/\\]?\s*door\s*[/\\]?\s*block(?:\s*no\.?)?/i;
  var hnLabelM = aN.match(hnLabelRe);
  if (hnLabelM) {
    var hnTail = aN.substring(hnLabelM.index + hnLabelM[0].length);
    var hnValRe = new RegExp("^\\s*[:\\-]?\\s*(.+?)(?=\\s+(?:" + STOP + "|\\bbuilding\\b|\\bblock\\b)|" + END + ")", "i");
    var hnValM = hnTail.match(hnValRe);
    if (hnValM && hnValM[1]) {
      var hnv = hnValM[1].replace(/^name\s*of\s*/i, "").replace(/^no\.?\s*[:\-]?\s*/i, "").trim();
      if (hnv && hnv.length >= 1 && hnv.length <= 60 && /[\w]/.test(hnv) && (/\d/.test(hnv) || hnv.length >= 3) && !isBadAddrVal(hnv)) { r.HouseNo = hnv; }
    }
    aN = (aN.substring(0, hnLabelM.index) + " " + aN.substring(hnLabelM.index + hnLabelM[0].length)).replace(/\s+/g, " ").trim();
  }

  var bM = aN.match(new RegExp("(?:name\\s*of\\s*)?premises\\s*[/\\\\]?\\s*(?:building)?\\s*[:\\-]?\\s*(.+?)(?=\\s+(?:" + STOP + "|\\bblock\\b)|" + END + ")", "i"));
  if (bM && bM[1]) {
    var bv = bM[1].replace(/^building\s*[:\-]?\s*/i, "").replace(/\s+building\s*$/i, "").replace(/\s+no\.?\s*$/i, "").trim();
    if (bv && bv.length >= 2 && bv.length <= 60 && /[A-Za-z]/.test(bv) && !isBadAddrVal(bv)) { r.Building = bv; }
    aN = aN.replace(bM[0], " ").replace(/\s+/g, " ");
  }

  var vM = aN.match(new RegExp("village\\s*[/\\\\]?\\s*town\\s*[:\\-]?\\s*(.+?)(?=\\s+(?:" + STOP + "|\\bblock\\b)|" + END + ")", "i"));
  if (vM && vM[1]) {
    var vv = vM[1].trim();
    if (vv && vv.length >= 1 && vv.length <= 60 && /[A-Za-z]/.test(vv) && !isBadAddrVal(vv)) { r["Village/Town"] = vv; }
    aN = aN.replace(vM[0], " ").replace(/\s+/g, " ");
  }

  var blkM = aN.match(new RegExp("\\bblock\\s*[:\\-]?\\s*(.+?)(?=\\s+(?:" + STOP + ")|" + END + ")", "i"));
  if (blkM && blkM[1]) {
    var blkv = blkM[1].trim();
    if (blkv && blkv.length >= 1 && blkv.length <= 60 && !/^industries?\b/i.test(blkv) && /[A-Za-z]/.test(blkv) && !isBadAddrVal(blkv)) { r.Block = blkv; }
    aN = aN.replace(blkM[0], " ").replace(/\s+/g, " ");
  }

  var sM = aN.match(new RegExp("road\\s*[/\\\\]?\\s*street\\s*[/\\\\]?\\s*lane\\s*[:\\-]?\\s*(.+?)(?=\\s+(?:" + STOP + ")|" + END + ")", "i"));
  if (sM && sM[1]) {
    var sv = sM[1].trim();
    if (sv && sv.length >= 1 && sv.length <= 100 && /[A-Za-z]/.test(sv) && !isBadAddrVal(sv)) { r["Road/Street"] = sv; }
    aN = aN.replace(sM[0], " ").replace(/\s+/g, " ");
  }

  var cM = aN.match(new RegExp("\\bcity\\s*[:\\-]?\\s*(.+?)(?=\\s+(?:" + STOP + ")|" + END + ")", "i"));
  if (cM && cM[1]) {
    var cv = cM[1].trim();
    if (cv && cv.length >= 1 && cv.length <= 60 && /[A-Za-z]/.test(cv) && !isBadAddrVal(cv)) { r.City = cv; }
  }

  var stateFoot = t.match(/district\s*industries\s*centre[^(\n]*\(\s*([A-Za-z][A-Za-z\s]+?)\s*\)/i);
  if (stateFoot) {
    var sfv = stateFoot[1].trim();
    if (_msmeIsState(sfv)) { r.State = sfv; }
  }
  var tSpaced = _spaceMsmeLabels(t);
  if (!r.State) {
    tSpaced.split("\n").forEach(function (ln) {
      if (r.State) { return; }
      var s = ln.match(/(?:^|\s)state\b\s*[:\-]?\s*([A-Za-z][A-Za-z\s]{2,28}?)(?:\s+district\b|\s*[,|]|\s*$)/i);
      if (s) {
        var sv2 = s[1].trim();
        if (_msmeIsState(sv2)) { r.State = sv2; }
      }
    });
  }

  var distLines = tSpaced.split("\n");
  for (var di = 0; di < distLines.length && !r.District; di++) {
    var dln = distLines[di];
    if (/district\s*industries\s*centre/i.test(dln)) { continue; }
    var dm = dln.match(/(?:^|\s)district\s*[:\-]?\s*([A-Za-z][A-Za-z\s]{2,28}?)(?:\s*[,|]|\s*pin\b|\s*\(|\s*$)/i);
    if (dm) {
      var dv = dm[1].trim();
      if (!/^(?:industries?|centre|center)\b/i.test(dv)) { r.District = dv; }
    }
  }
  if (!r.District) {
    var distFoot = t.match(/district\s*industries\s*centre[^A-Za-z\n]*([A-Za-z][A-Za-z\s]+?)\s*\(/i);
    if (distFoot) { r.District = distFoot[1].trim(); }
  }

  var pin = t.match(/(?:pin\s*code|pincode|\bpin)\s*[:\-]?\s*(\d{6})/i) || t.match(/\b(\d{6})\b/);
  if (pin) { r.Pincode = pin[1]; }

  var addrParts = [r.HouseNo, r.Building, r["Village/Town"], r.Block, r["Road/Street"], r.City, r.District, r.State, r.Pincode]
    .filter(function (p) { return p; });

  return {
    udyamRegistrationNumber: r.MSME,
    enterpriseName: r["Enterprise Name"],
    enterpriseType: r["Enterprise Type"],
    registrationDate: r["Registration Date"],
    houseNo: r.HouseNo,
    building: r.Building,
    villageTown: r["Village/Town"],
    block: r.Block,
    roadStreet: r["Road/Street"],
    city: r.City,
    district: r.District,
    state: r.State,
    pincode: r.Pincode,
    address: addrParts.length ? addrParts.join(", ") : null,
    rawText: rawText,
  };
}

// ─── Cheque ───────────────────────────────────────────────────────────────────
function _findIFSC(sUp) {
  var m = sUp.match(/IFS[C]?(?:\s*CODE)?\s*[:\-.]?\s*([A-Z]{4}0[A-Z0-9]{6})/);
  if (m) { return m[1]; }
  var m2 = sUp.replace(/\s+/g, "").match(/IFS[C]?(?:CODE)?[:\-.]?([A-Z]{4}0[A-Z0-9]{6})/);
  if (m2) { return m2[1]; }
  var m4 = sUp.match(/\b([A-Z]{4}0[A-Z0-9]{6})\b/); if (m4) { return m4[1]; }
  return null;
}

function _findAcct(t, ifsc) {
  var tail = ifsc ? ifsc.substring(4) : "";
  var od = t.match(/(?:A[\/.]C|A\/C\s*N[Oo]|ACCOUNT\s*(?:NO\.?|NUMBER)?|ACCT\.?)\s*[:\-.|\s]*(?:OD|CC|SB|CA)?\s*(\d[\d\s]{7,20}\d)/i);
  if (od) { var a = od[1].replace(/\s+/g, ""); if (a.length >= 9 && a.length <= 18 && a !== tail) { return a; } }
  var lines = t.split("\n");
  for (var i = 0; i < lines.length; i++) {
    if (!/A\/?C|ACCOUNT|ACCT/.test(lines[i].toUpperCase())) { continue; }
    var comb = lines[i] + " " + (lines[i + 1] || "");
    var runs = comb.match(/\d+/g) || [];
    var candidates = [];
    for (var rr0 = 0; rr0 < runs.length; rr0++) {
      if (runs[rr0].length >= 9 && runs[rr0].length <= 18 && runs[rr0] !== tail) { candidates.push(runs[rr0]); }
    }
    if (candidates.length > 0) {
      candidates.sort(function (a2, b2) { return Math.abs(a2.length - 13) - Math.abs(b2.length - 13); });
      return candidates[0];
    }
  }
  var all = t.match(/\d{9,18}/g) || [];
  var allValid = [];
  for (var ar = 0; ar < all.length; ar++) {
    if (all[ar] === tail || /^(.)\1+$/.test(all[ar])) { continue; }
    allValid.push(all[ar]);
  }
  if (allValid.length) {
    allValid.sort(function (a2, b2) { return Math.abs(a2.length - 13) - Math.abs(b2.length - 13); });
    return allValid[0];
  }
  return null;
}

function parseChequeData(rawText) {
  var t = _clean(rawText);
  t = t.replace(/VALID\s+FOR\b[^\n]*/gi, "");
  var ifsc = _findIFSC(t.toUpperCase());
  return {
    ifscCode: ifsc,
    accountNumber: _findAcct(t, ifsc),
    bankName: bankNameFromIfsc(ifsc),
    rawText: rawText,
  };
}

module.exports = {
  parseGSTData,
  parsePANData,
  parseMSMEData,
  parseChequeData,
  bankNameFromIfsc,
};
