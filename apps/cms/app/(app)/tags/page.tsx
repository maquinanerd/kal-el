"use client";

import { TaxonomyManager } from "../../../components/TaxonomyManager";
import { createTag, deleteTag, listTags, updateTag } from "../../../lib/api";

export default function TagsPage() {
  return <TaxonomyManager title="Tags" load={listTags} create={createTag} update={updateTag} remove={deleteTag} />;
}
