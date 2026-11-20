import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('emoji-picker-react', () => ({
  default: ({
    onEmojiClick,
    theme,
    previewConfig,
    skinTonesDisabled,
    lazyLoadEmojis,
  }: {
    onEmojiClick: (emoji: { emoji: string }) => void;
    theme: string;
    previewConfig: { showPreview: boolean };
    skinTonesDisabled: boolean;
    lazyLoadEmojis: boolean;
  }) => (
    <input
      type="button"
      value="Choose emoji"
      data-theme={theme}
      data-preview={String(previewConfig.showPreview)}
      data-skin-tones-disabled={String(skinTonesDisabled)}
      data-lazy={String(lazyLoadEmojis)}
      onClick={() => onEmojiClick({ emoji: '👍' })}
    />
  ),
  Theme: { DARK: 'dark', LIGHT: 'light' },
}));

import EmojiPicker from '@/components/chat/EmojiPicker';

describe('EmojiPicker', () => {
  it('preserves the reaction picker contract with the React 19-compatible implementation', () => {
    const onSelect = vi.fn();
    render(<EmojiPicker theme="dark" onSelect={onSelect} />);

    const picker = screen.getByRole('button', { name: 'Choose emoji' });
    expect(picker).toHaveAttribute('data-theme', 'dark');
    expect(picker).toHaveAttribute('data-preview', 'false');
    expect(picker).toHaveAttribute('data-skin-tones-disabled', 'true');
    expect(picker).toHaveAttribute('data-lazy', 'true');

    fireEvent.click(picker);
    expect(onSelect).toHaveBeenCalledWith('👍');
  });
});
