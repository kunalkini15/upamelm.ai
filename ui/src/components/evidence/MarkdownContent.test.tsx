// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownContent } from './MarkdownContent';

describe('MarkdownContent', () => {
  it('renders authored Markdown instead of exposing its formatting markers', () => {
    const { container } = render(<MarkdownContent content={'The **stage of extraction is 68.44%**.\n\n- First item\n- Second item'} />);

    expect(screen.getByText('stage of extraction is 68.44%').tagName).toBe('STRONG');
    expect(container.textContent).not.toContain('**');
    expect(container.querySelectorAll('li')).toHaveLength(2);
  });

  it('does not interpret raw HTML from a package as DOM markup', () => {
    const { container } = render(<MarkdownContent content={'<script>alert("unsafe")</script>\n\n**safe**'} />);

    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText('safe').tagName).toBe('STRONG');
  });
});
