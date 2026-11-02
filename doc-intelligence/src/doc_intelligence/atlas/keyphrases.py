from __future__ import annotations

import math
import re
from collections import Counter
from typing import Dict, List, Optional, Set, Tuple

from doc_intelligence.indexing.indexer import STOPWORDS

# Additional stop words specific to document structure/boilerplate
ADDITIONAL_STOPWORDS = {
    "et", "al", "fig", "ref", "vol", "no", "pp", "dept", "govt", "india", "state",
    "report", "chapter", "section", "annexure", "appendix", "table", "figure",
    "given", "shown", "follows", "based", "using", "used", "per", "within",
    "across", "among", "along", "whether", "either", "neither", "via", "etc"
}
ALL_STOPWORDS: Set[str] = STOPWORDS.union(ADDITIONAL_STOPWORDS)


class KeyphraseExtractor:
    """
    Deterministic keyphrase extraction using YAKE/TF-IDF principles:
    - n-grams (1 to 3 words)
    - Term frequency & position weighting (words near top get higher score)
    - Casing bonus (Title Case and Acronyms)
    - Inverse Document Frequency (IDF) when corpus is available
    - Stopword boundary filtering
    - Subphrase deduplication
    """

    @classmethod
    def extract_page_keyphrases(
        cls,
        page_text: str,
        corpus_dfs: Optional[Dict[str, int]] = None,
        total_pages: int = 1,
        min_keyphrases: Optional[int] = None,
        max_keyphrases: Optional[int] = None,
    ) -> List[str]:
        """
        Extract informative, deduplicated keyphrases for a single page.
        
        If min_keyphrases/max_keyphrases are not specified, bounds are dynamically
        determined based on the page word count to maximize information density and
        eliminate token bloat on sparse/cover pages:
          - Sparse / Cover (< 40 words): 3 - 5 keyphrases
          - Short / Narrative (40 - 150 words): 5 - 8 keyphrases
          - Standard Body (150 - 400 words): 8 - 12 keyphrases
          - Dense / Tabular (> 400 words): 12 - 18 keyphrases
        """
        if not page_text or len(page_text.strip()) < 20:
            return []

        # 1. Clean and tokenize into raw tokens with original casing preserved
        raw_words = re.findall(r"\b[A-Za-z0-9][A-Za-z0-9_\-]*[A-Za-z0-9]\b|\b[A-Za-z0-9]\b", page_text)
        if not raw_words:
            return []

        total_words = len(raw_words)

        # Dynamic budget allocation based purely on text density
        if min_keyphrases is None or max_keyphrases is None:
            if total_words < 40:
                dyn_min, dyn_max = 3, 5
            elif total_words < 150:
                dyn_min, dyn_max = 5, 8
            elif total_words < 400:
                dyn_min, dyn_max = 8, 12
            else:
                dyn_min, dyn_max = 12, 18
            target_min = min_keyphrases if min_keyphrases is not None else dyn_min
            target_max = max_keyphrases if max_keyphrases is not None else dyn_max
        else:
            target_min = min_keyphrases
            target_max = max_keyphrases
        
        # 2. Extract candidate 1-, 2-, and 3-grams
        candidates: Dict[str, Dict[str, float]] = {}  # normalized_phrase -> {tf, first_pos, casing_score, ...}

        for n in (1, 2, 3):
            for i in range(len(raw_words) - n + 1):
                gram = raw_words[i : i + n]
                
                # Boundary check: first and last token cannot be stopword or purely digits
                first_lower = gram[0].lower()
                last_lower = gram[-1].lower()

                if first_lower in ALL_STOPWORDS or last_lower in ALL_STOPWORDS:
                    continue
                if gram[0].isdigit() or gram[-1].isdigit():
                    continue
                if any(len(w) < 2 for w in gram):
                    continue

                # Normalized key
                norm = " ".join(w.lower() for w in gram)

                # Skip if norm contains special characters only or is in stopwords
                if norm in ALL_STOPWORDS or len(norm) < 3:
                    continue

                if norm not in candidates:
                    # Compute casing bonus
                    casing_bonus = 1.0
                    for w in gram:
                        if w.isupper() and len(w) >= 2:
                            casing_bonus += 0.5  # acronym like CGWB, WLS, TDS
                        elif w[0].isupper():
                            casing_bonus += 0.25  # Title Case

                    candidates[norm] = {
                        "count": 0.0,
                        "first_pos": float(i),
                        "casing_score": casing_bonus,
                        "length": float(n),
                        "original": " ".join(gram)
                    }
                
                candidates[norm]["count"] += 1.0

        if not candidates:
            return []

        # 3. Score candidates
        scored: List[Tuple[float, str]] = []
        for norm, stats in candidates.items():
            tf = stats["count"]
            # Position score: earlier positions score higher (0 to 1)
            pos_ratio = stats["first_pos"] / max(1.0, float(total_words))
            pos_score = 1.0 / (1.0 + math.log(1.0 + pos_ratio * 10.0))

            # IDF score if corpus available
            idf = 1.0
            if corpus_dfs and total_pages > 1:
                # Use document frequency of first informative word
                tokens = norm.split()
                df_val = max(corpus_dfs.get(t, 1) for t in tokens)
                idf = math.log((total_pages + 1.0) / (df_val + 0.5)) + 1.0

            # Length bonus for multi-word phrases (e.g. 2-grams and 3-grams)
            length_bonus = 1.0 + (stats["length"] - 1.0) * 0.4

            # Combined score (higher is better)
            score = (tf ** 0.6) * stats["casing_score"] * pos_score * idf * length_bonus
            scored.append((score, norm))

        # Sort by score descending
        scored.sort(key=lambda x: x[0], reverse=True)

        # 4. Deduplicate (filter redundant sub-phrases)
        selected: List[str] = []
        for score, phrase in scored:
            if len(selected) >= target_max:
                break
            
            # Check if this phrase is a strict sub-phrase or duplicate token set of an already selected phrase
            is_redundant = False
            phrase_tokens = set(phrase.split())
            for s in selected:
                s_tokens = set(s.split())
                # If existing phrase covers this phrase or vice-versa
                if phrase in s and len(phrase_tokens) <= len(s_tokens):
                    is_redundant = True
                    break
                if s in phrase and len(s_tokens) < len(phrase_tokens):
                    # phrase is a superset of an existing one. If tokens overlap > 80%, skip
                    if phrase_tokens.issuperset(s_tokens):
                        is_redundant = True
                        break
            
            if not is_redundant:
                selected.append(phrase)

        # If too few, fill with remaining distinct phrases
        if len(selected) < target_min:
            for score, phrase in scored:
                if phrase not in selected:
                    selected.append(phrase)
                if len(selected) >= target_min:
                    break

        return selected[:target_max]
