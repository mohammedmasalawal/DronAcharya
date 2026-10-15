import { ScoringTreeSchema, type ScoringTree } from '../schema';
import treeJson from '../../data/scoring-tree.default.json';

export const DEFAULT_TREE: ScoringTree = ScoringTreeSchema.parse(treeJson);
