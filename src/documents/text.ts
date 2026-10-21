const MAX_TEXT_CHARACTERS = 100_000;
const TRUNCATION_NOTE =
  '\n\n[Output truncated at 100,000 characters or the 200 page/slide limit. Read the original Canvas file for the remaining content.]';

/** Bounds extracted content, including section labels and the truncation notice. */
export class DocumentText {
  private value = '';
  private truncated = false;

  get full(): boolean {
    return this.value.length >= MAX_TEXT_CHARACTERS - TRUNCATION_NOTE.length;
  }

  add(label: string, text: string): void {
    const section = `${this.value ? '\n\n' : ''}${label}\n${text}`;
    const available =
      MAX_TEXT_CHARACTERS - TRUNCATION_NOTE.length - this.value.length;
    this.value += section.slice(0, available);
    if (section.length > available) this.truncated = true;
  }

  markTruncated(): void {
    this.truncated = true;
  }

  toString(): string {
    return this.value + (this.truncated ? TRUNCATION_NOTE : '');
  }
}
