from __future__ import annotations

import re
from collections import Counter
from typing import Dict, List, Set

from doc_intelligence.models.document import BlockType, ParsedDocument
from doc_intelligence.models.index import (
    DocumentIndex,
    FigureIndexItem,
    PageQualityIndicator,
    PageSummary,
    SectionNode,
    TableIndexItem,
)

# Standard common stop words (domain-agnostic)
STOPWORDS = {
    "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are",
    "aren't", "as", "at", "be", "because", "been", "before", "being", "below", "between", "both",
    "but", "by", "can't", "cannot", "could", "couldn't", "did", "didn't", "do", "does", "doesn't",
    "doing", "don't", "down", "during", "each", "few", "for", "from", "further", "had", "hadn't",
    "has", "hasn't", "have", "haven't", "having", "he", "he'd", "he'll", "he's", "her", "here",
    "here's", "hers", "herself", "him", "himself", "his", "how", "how's", "i", "i'd", "i'll",
    "i'm", "i've", "if", "in", "into", "is", "isn't", "it", "it's", "its", "itself", "let's",
    "me", "more", "most", "mustn't", "my", "myself", "no", "nor", "not", "of", "off", "on", "once",
    "only", "or", "other", "ought", "our", "ours", "ourselves", "out", "over", "own", "same",
    "shan't", "she", "she'd", "she'll", "she's", "should", "shouldn't", "so", "some", "such",
    "than", "that", "that's", "the", "their", "theirs", "them", "themselves", "then", "there",
    "there's", "these", "they", "they'd", "they'll", "they're", "they've", "this", "those",
    "through", "to", "too", "under", "until", "up", "very", "was", "wasn't", "we", "we'd",
    "we'll", "we're", "we've", "were", "weren't", "what", "what's", "when", "when's", "where",
    "where's", "which", "while", "who", "who's", "whom", "why", "why's", "with", "won't", "would",
    "wouldn't", "you", "you'd", "you'll", "you're", "you've", "your", "yours", "yourself",
    "yourselves", "table", "figure", "page", "total", "also", "may", "can", "one", "two", "three",
}


def tokenize(text: str) -> List[str]:
    """Tokenize alphanumeric words, convert to lowercase, filter out stop words and short tokens."""
    # Normalize hyphens, underscores, slashes, and punctuation to spaces so compound phrases split
    clean_text = re.sub(r"[_\-/\\]+", " ", text)
    words = re.findall(r"\b[a-zA-Z0-9]{3,}\b", clean_text.lower())
    return [w for w in words if w not in STOPWORDS and not w.isdigit()]


class DocumentIndexer:
    """Builds a compact, navigable structural index of a parsed document."""

    @classmethod
    def build_index(cls, document: ParsedDocument) -> DocumentIndex:
        sections: List[SectionNode] = []
        tables: List[TableIndexItem] = []
        figures: List[FigureIndexItem] = []
        page_summaries: List[PageSummary] = []
        quality_indicators: List[PageQualityIndicator] = []
        vocabulary: Dict[str, Set[int]] = {}

        for page in document.pages:
            p_num = page.page_number
            text = page.text or ""
            words = tokenize(text)
            char_count = len(text)
            word_count = len(words)

            # 1. Section Headings
            for block in page.blocks:
                if block.block_type in (BlockType.TITLE, BlockType.HEADING):
                    clean_title = block.text.strip().split("\n")[0][:100]
                    sections.append(
                        SectionNode(
                            title=clean_title,
                            level=block.level or 2,
                            page_number=p_num,
                            bbox=block.bbox,
                        )
                    )

            # 2. Tables
            for tab in page.tables:
                tables.append(
                    TableIndexItem(
                        table_id=tab.table_id,
                        page_number=p_num,
                        caption=tab.caption,
                        column_count=len(tab.headers) or (len(tab.rows[0]) if tab.rows else 0),
                        row_count=len(tab.rows),
                    )
                )

            # 3. Figures
            for img in page.images:
                figures.append(
                    FigureIndexItem(
                        image_id=img.image_id,
                        page_number=p_num,
                        caption=img.caption,
                    )
                )

            # 4. Vocabulary / Inverted Index
            top_counts = Counter(words).most_common(5)
            top_kw = [k for k, _ in top_counts]

            for word in set(words):
                if word not in vocabulary:
                    vocabulary[word] = set()
                vocabulary[word].add(p_num)

            # 5. Quality Indicators
            # Low text with images might imply scanned/OCR needed
            is_scanned = (word_count < 15 and len(page.images) > 0)
            confidence = 0.5 if is_scanned else (0.8 if word_count < 25 else 1.0)

            quality_indicators.append(
                PageQualityIndicator(
                    page_number=p_num,
                    character_count=char_count,
                    word_count=word_count,
                    has_tables=len(page.tables) > 0,
                    has_images=len(page.images) > 0,
                    is_scanned_suspicion=is_scanned,
                    confidence_score=confidence,
                )
            )

            # Snippet (first 160 characters)
            snippet = text.strip()[:160].replace("\n", " ")

            page_summaries.append(
                PageSummary(
                    page_number=p_num,
                    printed_page_number=page.printed_page_number,
                    char_count=char_count,
                    word_count=word_count,
                    top_keywords=top_kw,
                    has_tables=len(page.tables) > 0,
                    has_figures=len(page.images) > 0,
                    preview_snippet=snippet,
                )
            )

        vocab_dict = {k: sorted(list(v)) for k, v in vocabulary.items()}

        return DocumentIndex(
            document_id=document.metadata.document_id,
            total_pages=len(document.pages),
            sections=sections,
            tables=tables,
            figures=figures,
            page_summaries=page_summaries,
            quality_indicators=quality_indicators,
            vocabulary=vocab_dict,
        )

    @classmethod
    def query_relevant_pages(
        cls,
        index: DocumentIndex,
        query_terms: List[str],
        max_pages: int = 5,
    ) -> List[int]:
        """Rank and return relevant page numbers based on keyword query matches."""
        page_scores: Counter[int] = Counter()

        cleaned_tokens: List[str] = []
        for term in query_terms:
            cleaned_tokens.extend(tokenize(term))

        for token in cleaned_tokens:
            if token in index.vocabulary:
                for p_no in index.vocabulary[token]:
                    page_scores[p_no] += 1

        # Also give points to section titles matching query terms
        for sec in index.sections:
            sec_words = tokenize(sec.title)
            overlap = set(sec_words).intersection(cleaned_tokens)
            if overlap:
                page_scores[sec.page_number] += 2 * len(overlap)

        if not page_scores:
            # Fall back to first min(max_pages, total_pages)
            return list(range(1, min(max_pages + 1, index.total_pages + 1)))

        sorted_pages = [p for p, _ in page_scores.most_common(max_pages)]
        return sorted(sorted_pages)
