# SCSS Setup Guide

This project uses SCSS (Sass) for styling. SCSS is a superset of CSS that adds powerful features like variables, nesting, mixins, and more.

## Files Structure

- `globals.scss` - Global styles imported in `_app.tsx`
- `Home.module.scss` - Component-specific module styles (CSS Modules)

## SCSS Features Available

### 1. Variables
```scss
$primary-color: #007bff;
$padding: 16px;

.button {
  color: $primary-color;
  padding: $padding;
}
```

### 2. Nesting
```scss
.nav {
  background: white;
  
  ul {
    list-style: none;
    
    li {
      display: inline-block;
      
      a {
        color: blue;
        
        &:hover {
          color: darkblue;
        }
      }
    }
  }
}
```

### 3. Mixins
```scss
@mixin flex-center {
  display: flex;
  justify-content: center;
  align-items: center;
}

.container {
  @include flex-center;
}
```

### 4. Partials and @use (Modern Module System)
Create a file like `_variables.scss` and use it:
```scss
@use 'variables' as *; // Import all members without namespace
// OR
@use 'variables'; // Use with namespace: variables.$primary-color
```

### 5. Functions
```scss
@function calculate-rem($size) {
  @return $size / 16px * 1rem;
}

.text {
  font-size: calculate-rem(24px); // 1.5rem
}
```

## Usage Examples

### Creating a new SCSS module
1. Create file: `components/Button.module.scss`
2. Import in your component:
```tsx
import styles from './Button.module.scss';

export default function Button() {
  return <button className={styles.button}>Click me</button>;
}
```

### Adding global styles
Add to `globals.scss`:
```scss
body {
  font-family: Arial, sans-serif;
}
```

## Best Practices

1. Use variables for colors, spacing, and repeated values
2. Keep nesting depth to 3-4 levels max
3. Use mixins for reusable patterns
4. Create partials (_filename.scss) for organization
5. Use meaningful class names with BEM methodology
6. Use `@use` instead of `@import` (modern standard)
7. Use `@forward` to re-export modules when needed

## Resources

- [Sass Documentation](https://sass-lang.com/documentation)
- [SCSS Basics](https://sass-lang.com/guide)
