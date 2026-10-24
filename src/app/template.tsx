// Every page arrives with a short fade-slide (the motion spec, docs/design/area-pages.md): a
// template, so it plays on each navigation while the layout (the top bar, the side chat) stays.
// The wrapper keeps the page's flex column, and the animation leaves no transform behind, so
// the pop-ups' fixed positions stay the window's.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-in flex flex-1 flex-col">{children}</div>;
}
