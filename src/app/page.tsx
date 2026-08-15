import { CommandCenter } from "@/features/command-center/CommandCenter";

/**
 * The Command Center is the home experience. There is no marketing page and no
 * landing route — opening Atlas Ascend puts you directly on the primary
 * surface, which is what separates an application from a website.
 */
export default function Page() {
  return <CommandCenter />;
}
