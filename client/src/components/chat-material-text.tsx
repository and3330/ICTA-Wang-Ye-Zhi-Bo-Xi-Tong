/** Plain text plus HTTPS links only: never interpret host content as HTML. */
export function ChatMaterialText({ text }: { text: string }) {
  return <span className="whitespace-pre-wrap break-words">{text.split(/(https:\/\/[^\s<>]+)/g).map((part, index) =>
    /^https:\/\//.test(part)
      ? <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 break-all focus-visible:outline focus-visible:outline-2">{part}</a>
      : part,
  )}</span>;
}
