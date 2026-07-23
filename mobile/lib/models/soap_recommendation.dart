class Soap {
  final String id;
  final String nameEn;
  final String nameAr;
  final String imageAsset;
  final List<String> keyActives;
  final List<String> bestForSkinTypes;
  final List<String> targetsConcerns;
  final List<String> cautions;
  final bool isPhotosensitizing;

  Soap({
    required this.id,
    required this.nameEn,
    required this.nameAr,
    required this.imageAsset,
    required this.keyActives,
    required this.bestForSkinTypes,
    required this.targetsConcerns,
    required this.cautions,
    required this.isPhotosensitizing,
  });

  factory Soap.fromJson(Map<String, dynamic> json) {
    return Soap(
      id: json['id'] ?? '',
      nameEn: json['nameEn'] ?? '',
      nameAr: json['nameAr'] ?? '',
      imageAsset: json['imageAsset'] ?? '',
      keyActives: List<String>.from(json['keyActives'] ?? []),
      bestForSkinTypes: List<String>.from(json['bestForSkinTypes'] ?? []),
      targetsConcerns: List<String>.from(json['targetsConcerns'] ?? []),
      cautions: List<String>.from(json['cautions'] ?? []),
      isPhotosensitizing: json['isPhotosensitizing'] ?? false,
    );
  }
}

class SoapRecommendation {
  final Soap soap;
  final double score;
  final List<String> matchedConcerns;
  final String reasoning;

  SoapRecommendation({
    required this.soap,
    required this.score,
    required this.matchedConcerns,
    required this.reasoning,
  });

  factory SoapRecommendation.fromJson(Map<String, dynamic> json) {
    return SoapRecommendation(
      soap: Soap.fromJson(json['soap'] is Map<String, dynamic> ? json['soap'] : {}),
      score: (json['score'] ?? 0).toDouble(),
      matchedConcerns: List<String>.from(json['matchedConcerns'] ?? []),
      reasoning: json['reasoning'] ?? '',
    );
  }
}

class SkinReport {
  final String skinType;
  final String confidence;
  final String summary;
  final List<String> careTips;
  final String caveats;
  final List<SoapRecommendation> recommendedSoaps;

  SkinReport({
    required this.skinType,
    required this.confidence,
    required this.summary,
    required this.careTips,
    required this.caveats,
    required this.recommendedSoaps,
  });

  factory SkinReport.fromJson(Map<String, dynamic> json) {
    final soapsJson = json['recommendedSoaps'] as List? ?? [];
    return SkinReport(
      skinType: json['skin_type'] ?? 'normal',
      confidence: json['confidence'] ?? 'medium',
      summary: json['summary'] ?? '',
      careTips: List<String>.from(json['care_tips'] ?? []),
      caveats: json['caveats'] ?? '',
      recommendedSoaps: soapsJson
          .map((e) => SoapRecommendation.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }
}
