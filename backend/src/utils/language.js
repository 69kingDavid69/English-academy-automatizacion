/**
 * Simple language detection for Spanish vs English.
 * Returns 'es' for Spanish, 'en' for English (default).
 */
export function detectLanguage(text) {
  if (!text || typeof text !== 'string') return 'en';

  const trimmed = text.trim().toLowerCase();
  
  // Common Spanish words and characters
  const spanishIndicators = [
    /\b(hola|gracias|por favor|quiero|pregunta|información|curso|precio|horario|inscripción)\b/i,
    /\b(sí|no|y|o|pero|porque|como|cuando|donde|que|quien)\b/i,
    /\b(el|la|los|las|un|una|unos|unas)\b/i,
    /[áéíóúñ¿¡]/,
  ];

  // Common English words
  const englishIndicators = [
    /\b(hello|hi|thanks|thank you|please|want|question|information|course|price|schedule|enrollment)\b/i,
    /\b(yes|no|and|or|but|because|how|when|where|what|who)\b/i,
    /\b(the|a|an|some|any)\b/i,
  ];

  let spanishScore = 0;
  let englishScore = 0;

  for (const regex of spanishIndicators) {
    if (regex.test(trimmed)) spanishScore++;
  }

  for (const regex of englishIndicators) {
    if (regex.test(trimmed)) englishScore++;
  }

  // If text contains Spanish-specific characters, strongly indicate Spanish
  if (/[áéíóúñ¿¡]/.test(trimmed)) {
    spanishScore += 2;
  }

  return spanishScore > englishScore ? 'es' : 'en';
}

/**
 * Get appropriate message based on detected language
 */
export function getLocalizedMessage(messages) {
  return function(text) {
    const lang = detectLanguage(text);
    return messages[lang] || messages.en || messages.es || '';
  };
}

/**
 * Predefined localized messages for common responses
 */
export const localizedMessages = {
  noContext: {
    en: "I don't have specific information about that in our knowledge base. One of our advisors will be happy to help you.",
    es: "No tengo información específica sobre eso en nuestra base de conocimientos. Uno de nuestros asesores estará encantado de ayudarte."
  },
  advisorNotified: {
    en: "An advisor has been notified and will contact you shortly. Our hours are Monday-Friday 8am-7pm.",
    es: "Se ha notificado a un asesor y se comunicará contigo en breve. Nuestro horario es de lunes a viernes de 8am a 7pm."
  },
  offTopic: {
    en: "I can only help with questions about our academy's courses, pricing, schedules, and enrollment.",
    es: "Solo puedo ayudar con preguntas sobre los cursos, precios, horarios e inscripción de nuestra academia."
  }
};