export type CollectionTemplate = {
  id: string;
  icon: string;
  nameKey: string;
  descriptionKey: string;
};

export const collectionTemplates: CollectionTemplate[] = [
  {
    id: "hot-wheels",
    icon: "🏎️",
    nameKey: "templateHotWheelsName",
    descriptionKey: "templateHotWheelsDesc",
  },
  {
    id: "stamps",
    icon: "📮",
    nameKey: "templateStampsName",
    descriptionKey: "templateStampsDesc",
  },
  {
    id: "coins",
    icon: "🪙",
    nameKey: "templateCoinsName",
    descriptionKey: "templateCoinsDesc",
  },
  {
    id: "vinyl",
    icon: "🎵",
    nameKey: "templateVinylName",
    descriptionKey: "templateVinylDesc",
  },
  {
    id: "cards",
    icon: "🃏",
    nameKey: "templateCardsName",
    descriptionKey: "templateCardsDesc",
  },
  {
    id: "comics",
    icon: "📚",
    nameKey: "templateComicsName",
    descriptionKey: "templateComicsDesc",
  },
  {
    id: "figurines",
    icon: "🧸",
    nameKey: "templateFigurinesName",
    descriptionKey: "templateFigurinesDesc",
  },
  {
    id: "watches",
    icon: "⌚",
    nameKey: "templateWatchesName",
    descriptionKey: "templateWatchesDesc",
  },
  {
    id: "sneakers",
    icon: "👟",
    nameKey: "templateSneakersName",
    descriptionKey: "templateSneakersDesc",
  },
  {
    id: "art",
    icon: "🎨",
    nameKey: "templateArtName",
    descriptionKey: "templateArtDesc",
  },
];
