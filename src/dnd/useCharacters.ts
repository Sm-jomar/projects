import { useSyncExternalStore } from "react";
import { getCharactersSnapshot, subscribeCharacters } from "./dndStorage";
import type { DndCharacter } from "./dndTypes";

/** Live list of locally saved characters (newest first). */
export function useCharacters(): DndCharacter[] {
  return useSyncExternalStore(subscribeCharacters, getCharactersSnapshot);
}
