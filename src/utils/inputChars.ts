export const inputCharsFromBody = (body: { text?: string; messages?: Array<{ content: string }> }) => {
  return (body.text?.length ?? 0) + (body.messages?.reduce((s, m) => s + m.content.length, 0) ?? 0);
};
