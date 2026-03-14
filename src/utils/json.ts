export const ensureJsonWordInMessages = (messages: any[]): any[] => {
  const hasJsonWord = messages.some((m: any) =>
    typeof m?.content === "string" && /\bjson\b/i.test(m.content)
  );
  if (hasJsonWord) return messages;
  return [
    {
      role: "system",
      content: "Return output as valid JSON only. Do not include markdown or extra text.",
    },
    ...messages,
  ];
};

export const hardenGraphJsonContract = (mem: any): any => {
  const graphMemory = mem?.graphMemory;
  const structuredLlm = graphMemory?.structuredLlm;
  if (!structuredLlm || typeof structuredLlm.generateResponse !== "function") return mem;
  if ((structuredLlm as any).__jsonContractPatched) return mem;

  const original = structuredLlm.generateResponse.bind(structuredLlm);
  structuredLlm.generateResponse = async (
    messages: any[],
    responseFormat?: { type?: string },
    tools?: any[],
  ) => {
    const normalizedMessages =
      responseFormat?.type === "json_object" ? ensureJsonWordInMessages(messages) : messages;
    return original(normalizedMessages, responseFormat, tools);
  };
  (structuredLlm as any).__jsonContractPatched = true;
  return mem;
};
