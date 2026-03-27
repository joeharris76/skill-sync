# Code to Spec Reference

Generate specification documents from existing code.

## Process

1. **Read/Analyze**: Parse structure, extract docstrings/comments, identify public vs private APIs, map dependencies
2. **Extract Interfaces**:
   - **Classes**: Hierarchy, public attrs/types, method signatures
   - **Functions**: Signature, params, return type, exceptions, side effects
   - **Modules**: Public exports, functions, classes, constants
3. **Document Behavior**: Purpose, preconditions, postconditions, invariants, side effects
4. **Map Dependencies**: External packages, internal modules, config, env vars
5. **Identify Constraints**: Input validation, state requirements, ordering, concurrency
6. **Capture Data Structures**: Classes/attrs, TypedDicts, dataclasses, enums, config schemas

## Output Template

```markdown
## Specification: {name}

### Overview
{Brief description from docstring}

### Location
**File**: `{path}` | **Module**: `{module}` | **Lines**: {range}

### Public Interface

#### `ClassName`
{docstring}
**Inheritance**: `Parent` -> `ClassName`

**Attributes**:
| Name | Type | Description | Default |
|------|------|-------------|---------|

**Methods**:
| Method | Signature | Description |
|--------|-----------|-------------|

##### `method(arg: Type) -> ReturnType`
**Parameters**: `arg` (Type): Description
**Returns**: ReturnType - Description
**Raises**: `ValueError` - When {condition}

### Dependencies
| Package/Module | Purpose |
|----------------|---------|

### Configuration
| Parameter | Type | Default | Required |
|-----------|------|---------|----------|

### Environment Variables
| Variable | Purpose | Default |
|----------|---------|---------|

### Behavior Specification
**Preconditions**: {conditions before calling}
**Postconditions**: {conditions after calling}
**Invariants**: {always true}
**Side Effects**: {external state changes}

### Error Handling
| Exception | Condition | Recovery |
|-----------|-----------|----------|

### Examples
```python
from {module} import ClassName
result = ClassName(config).method(input)
```

### Notes
- {Implementation details, limitations, thread safety}
```

## Extraction Sources

| Element | Source |
|---------|--------|
| Descriptions | Docstrings |
| Types | Type hints |
| Parameters | Signatures |
| Exceptions | Docstrings, raise statements |
| Dependencies | Import statements |
