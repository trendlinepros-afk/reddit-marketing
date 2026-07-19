import { AiProviderName } from '../types';
import { AiProvider } from './provider';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';

const instances: Partial<Record<AiProviderName, AiProvider>> = {};

export function getAiProvider(name: AiProviderName): AiProvider {
  if (!instances[name]) {
    instances[name] = name === 'gemini' ? new GeminiProvider() : new AnthropicProvider();
  }
  return instances[name]!;
}
