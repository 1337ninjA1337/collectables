import { ReactNode } from "react";
import { FlatList, ScrollView } from "react-native";

export type RenderItemParams<T> = {
  item: T;
  drag: () => void;
  isActive: boolean;
  getIndex: () => number | undefined;
};

const noop = () => {};

function adaptRenderItem<T>(
  renderItem?: (params: RenderItemParams<T>) => ReactNode,
) {
  if (!renderItem) return undefined;
  return ({ item, index }: { item: T; index: number }) =>
    renderItem({ item, drag: noop, isActive: false, getIndex: () => index });
}

function makeDraggableShim() {
  return function DraggableShim<T>(props: any) {
    const { renderItem, onDragEnd: _onDragEnd, activationDistance: _a, ...rest } = props;
    return <FlatList {...rest} renderItem={adaptRenderItem<T>(renderItem)} />;
  };
}

export const DraggableFlatList = makeDraggableShim();
export const NestableDraggableFlatList = makeDraggableShim();
export const NestableScrollContainer = ScrollView;
export function ScaleDecorator({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
