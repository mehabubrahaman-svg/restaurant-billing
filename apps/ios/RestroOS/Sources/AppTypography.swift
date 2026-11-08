import SwiftUI

/// The type scale, shared with the web app (`TYPO` in `@restroos/ui`) and the
/// Android app (`res/values/typography.xml`): the same token names and sizes,
/// so a title or a label looks the same whichever screen shows it
/// (docs/13-design-system.md). The face is Inter, bundled in Resources/Fonts;
/// if it can't be loaded the system font stands in at the same size and weight.
/// Every size follows the user's Dynamic Type setting from the text style it is
/// closest to.
enum AppTypography {
  /// The bundled font's PostScript name (its family name is "Inter Variable").
  static let fontName = "InterVariable"

  private static let interIsAvailable = UIFont(name: fontName, size: 16) != nil

  private static func font(_ size: CGFloat, _ weight: Font.Weight, as style: Font.TextStyle) -> Font {
    if interIsAvailable {
      return Font.custom(fontName, size: size, relativeTo: style).weight(weight)
    }
    return Font.system(size: size, weight: weight)
  }

  // Display: hero text
  static let displayLarge = font(30, .bold, as: .largeTitle)
  static let displayMedium = font(24, .bold, as: .title)

  // Titles: sections, dialogs, cards, rows
  static let titleLarge = font(20, .bold, as: .title2)
  static let titleMedium = font(18, .semibold, as: .title3)
  static let titleSmall = font(16, .semibold, as: .headline)

  // Body: running text
  static let bodyLarge = font(16, .regular, as: .body)
  static let bodyMedium = font(14, .regular, as: .subheadline)
  static let bodySmall = font(12, .regular, as: .caption)

  // Labels: text that belongs to a control
  static let labelLarge = font(16, .semibold, as: .body)
  static let labelMedium = font(14, .semibold, as: .subheadline)
  static let labelSmall = font(12, .semibold, as: .caption)

  /// The smallest readable note.
  static let caption = font(11, .regular, as: .caption2)

  /// The "R" mark on the connect screen.
  static let brandMark = font(40, .bold, as: .largeTitle)
}
