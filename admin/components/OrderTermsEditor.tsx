import React, { useCallback } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import styles from './OrderTermsEditor.module.scss';

export interface OrderTermsEditorProps {
  value: string;
  onChange: (html: string) => void;
}

function TermsToolbar({ editor }: { editor: Editor }) {
  const setLink = useCallback(() => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = typeof window !== 'undefined' ? window.prompt('Link URL', prev || 'https://') : null;
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor]);

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Formatting">
      <button
        type="button"
        className={styles.toolbarBtn}
        data-active={editor.isActive('heading', { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        H2
      </button>
      <button
        type="button"
        className={styles.toolbarBtn}
        data-active={editor.isActive('heading', { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        H3
      </button>
      <span className={styles.toolbarSep} />
      <button
        type="button"
        className={styles.toolbarBtn}
        data-active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        Bold
      </button>
      <button
        type="button"
        className={styles.toolbarBtn}
        data-active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        Italic
      </button>
      <button
        type="button"
        className={styles.toolbarBtn}
        data-active={editor.isActive('underline')}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        Underline
      </button>
      <span className={styles.toolbarSep} />
      <button
        type="button"
        className={styles.toolbarBtn}
        data-active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        List
      </button>
      <button
        type="button"
        className={styles.toolbarBtn}
        data-active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        1. List
      </button>
      <span className={styles.toolbarSep} />
      <button type="button" className={styles.toolbarBtn} data-active={editor.isActive('link')} onClick={setLink}>
        Link
      </button>
    </div>
  );
}

const OrderTermsEditor: React.FC<OrderTermsEditorProps> = ({ value, onChange }) => {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer nofollow' },
      }),
    ],
    content: value || '<p></p>',
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getHTML());
    },
  });

  if (!editor) {
    return (
      <div className={styles.wrap}>
        <div className={styles.loading}>Loading editor…</div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <TermsToolbar editor={editor} />
      <EditorContent editor={editor} className={styles.editor} />
    </div>
  );
};

export default OrderTermsEditor;
