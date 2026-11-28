/// BDB notes tokens — port of src/lib/bdbAbbreviations.ts (table generated from BDB_ABBR; do not hand-edit the table).
public enum BdbNotes {
    public enum Token: Equatable, Sendable { case text(String), abbr(expanded: String, raw: String), number(String) }

    public static let abbreviations: [String: String] = [
        "vb.": "verb",
        "n.": "noun",
        "n.m.": "noun, masculine",
        "n.f.": "noun, feminine",
        "n.m.pl.": "noun, masculine plural",
        "n.f.pl.": "noun, feminine plural",
        "n.pr.": "proper noun",
        "n.pr.m.": "proper noun, masculine",
        "n.pr.f.": "proper noun, feminine",
        "n.pr.loc.": "place name",
        "n.pr.gent.": "people-group name",
        "adj.": "adjective",
        "adj.gent.": "adjective, gentilic",
        "adv.": "adverb",
        "subst.": "substantive",
        "art.": "article",
        "conj.": "conjunction",
        "prep.": "preposition",
        "interj.": "interjection",
        "pron.": "pronoun",
        "prt.": "particle",
        "ptcp.": "participle",
        "denom.": "denominative",
        "Niph.": "Niphal",
        "Pi.": "Piel",
        "Pu.": "Pual",
        "Hiph.": "Hiphil",
        "Hoph.": "Hophal",
        "Hithp.": "Hithpael",
        "Hithpo.": "Hithpolel",
        "Po.": "Polel",
        "Pilp.": "Pilpel",
        "Pe.": "Peal",
        "Aph.": "Aphel",
        "Haph.": "Haphel",
        "Ithp.": "Ithpeal",
        "Shaph.": "Shaphel",
        "pl.": "plural",
        "sg.": "singular",
        "du.": "dual",
        "cstr.": "construct",
        "abs.": "absolute",
        "coll.": "collective",
        "sf.": "with suffix",
        "[m.]": "probably masculine",
        "n.[m.]": "noun, probably masculine",
        "n.[f.]": "noun, probably feminine",
        "n.[m.]pl.": "noun, probably masculine, plural",
        "n.[f.]pl.": "noun, probably feminine, plural",
        "n.[m.]du.": "noun, probably masculine, dual",
        "n.[m.]coll.": "noun, probably masculine, collective",
        "n.[m.]pl.abstr.": "noun, probably masculine, plural, abstract",
        "n.pr.[m.]": "proper noun, probably masculine",
    ]

    /// `tokenizeBdbNotes`: grammatical abbreviations expanded, bare numbers tagged, everything else prose (whitespace kept).
    public static func tokens(_ text: String) -> [Token] {
        var out: [Token] = []
        var i = text.startIndex
        while i < text.endIndex {
            let isSpace = text[i].isWhitespace
            var j = i
            while j < text.endIndex, text[j].isWhitespace == isSpace { j = text.index(after: j) }
            let part = String(text[i..<j]); i = j
            if isSpace { out.append(.text(part)); continue }
            let trail = (part.last == "," || part.last == ";") ? String(part.last!) : ""
            let core = trail.isEmpty ? part : String(part.dropLast())
            if let exp = abbreviations[core] {
                out.append(.abbr(expanded: exp, raw: core)); if !trail.isEmpty { out.append(.text(trail)) }
            } else if !core.isEmpty, core.count <= 5, core.allSatisfy(\.isASCII), core.allSatisfy(\.isNumber) {
                out.append(.number(core)); if !trail.isEmpty { out.append(.text(trail)) }
            } else {
                out.append(.text(part))
            }
        }
        return out
    }
}
