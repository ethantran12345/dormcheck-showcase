import Picker, { Theme, type EmojiClickData } from 'emoji-picker-react';

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  theme: 'light' | 'dark';
}

// Thin wrapper over the full picker. Default-exported so callers can React.lazy()
// it — the emoji dataset is sizeable and shouldn't ship in the main chunk. Theme
// is passed explicitly (the app uses class-based dark mode, so OS auto-detection
// would drift from the app theme).
export default function EmojiPicker({ onSelect, theme }: EmojiPickerProps) {
  return (
    <Picker
      theme={theme === 'dark' ? Theme.DARK : Theme.LIGHT}
      onEmojiClick={(emoji: EmojiClickData) => {
        onSelect(emoji.emoji);
      }}
      previewConfig={{ showPreview: false }}
      skinTonesDisabled
      lazyLoadEmojis
    />
  );
}
